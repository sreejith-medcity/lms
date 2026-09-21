import { createSign } from 'node:crypto';
import { db } from '@/lib/db';
import { resolveIntegration } from '@/lib/integration-store';
import type { PushPayload } from './push';

/**
 * Push to the phone app, through Firebase Cloud Messaging.
 *
 * The app registers its device token at `/api/v1/push` on every start; this
 * sends to every token a person holds. FCM's HTTP v1 API wants an OAuth
 * access token minted from a service account: the JSON key on the Firebase
 * card is turned into a signed JWT here with node's own crypto, exchanged
 * for a bearer token, and that token is kept for the fifty minutes it is
 * good for. No Firebase SDK, because one HTTPS call does not need one.
 *
 * A token FCM says is gone (UNREGISTERED, or a 404) is dropped rather than
 * retried at every notification for the rest of time.
 */

interface ServiceAccount {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
}

interface FcmConfig {
  projectId: string;
  account: ServiceAccount;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function config(organizationId: string): Promise<FcmConfig | null> {
  const resolved = await resolveIntegration(organizationId, 'fcm');
  if (!resolved?.complete) return null;
  let account: ServiceAccount;
  try {
    account = JSON.parse(resolved.values.serviceAccountJson) as ServiceAccount;
  } catch {
    return null;
  }
  const projectId = (resolved.values.projectId || account.project_id || '').trim();
  if (!projectId || !account.client_email || !account.private_key) return null;
  return { projectId, account };
}

export async function fcmConfigured(organizationId: string): Promise<boolean> {
  return (await config(organizationId)) !== null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** A bearer token for the FCM scope, minted from the service account and kept until shortly before it expires. */
async function accessToken(cfg: FcmConfig): Promise<string> {
  const cached = tokenCache.get(cfg.account.client_email!);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = cfg.account.token_uri || 'https://oauth2.googleapis.com/token';
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: cfg.account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUri, iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(cfg.account.private_key!));
  const assertion = `${header}.${claims}.${signature}`;
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google refused the service account (${res.status}).`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Google gave no access token for the service account.');
  tokenCache.set(cfg.account.client_email!, { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

/**
 * Send to every phone a person has signed in on. The notification carries
 * the same title, body and path the web push does, so the app opens the
 * right screen when it is tapped.
 */
export async function fcmToUser(organizationId: string, userId: string, payload: PushPayload): Promise<{ sent: number; gone: number; failed: string[] }> {
  const devices = await db.deviceToken.findMany({ where: { organizationId, userId }, select: { id: true, token: true } });
  return sendToDevices(organizationId, devices, payload, 'user');
}

/** The same, for a parent: their phones are keyed on the contact they sign in with. */
export async function fcmToParent(organizationId: string, contact: string, payload: PushPayload): Promise<{ sent: number; gone: number; failed: string[] }> {
  const devices = await db.parentDeviceToken.findMany({ where: { organizationId, contact }, select: { id: true, token: true } });
  return sendToDevices(organizationId, devices, payload, 'parent');
}

async function sendToDevices(organizationId: string, devices: { id: string; token: string }[], payload: PushPayload, table: 'user' | 'parent'): Promise<{ sent: number; gone: number; failed: string[] }> {
  const cfg = await config(organizationId);
  if (!cfg) return { sent: 0, gone: 0, failed: ['Firebase is not connected.'] };
  if (devices.length === 0) return { sent: 0, gone: 0, failed: [] };
  const touch = (id: string) => (table === 'user' ? db.deviceToken.update({ where: { id }, data: { lastSeenAt: new Date() } }) : db.parentDeviceToken.update({ where: { id }, data: { lastSeenAt: new Date() } }));
  const drop = (id: string) => (table === 'user' ? db.deviceToken.delete({ where: { id } }) : db.parentDeviceToken.delete({ where: { id } }));
  let bearer: string;
  try {
    bearer = await accessToken(cfg);
  } catch (err) {
    return { sent: 0, gone: 0, failed: [err instanceof Error ? err.message : String(err)] };
  }
  let sent = 0;
  let gone = 0;
  const failed: string[] = [];
  for (const d of devices) {
    const message = {
      token: d.token,
      notification: { title: payload.title.slice(0, 200), body: payload.body.slice(0, 500) },
      data: { url: payload.url ?? '', tag: payload.tag ?? '' },
      android: { priority: 'HIGH', notification: { channel_id: 'lms', tag: payload.tag || undefined } },
      apns: { payload: { aps: { sound: 'default', 'thread-id': payload.tag || undefined } } },
    };
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        sent += 1;
        await touch(d.id).catch(() => undefined);
        continue;
      }
      const text = await res.text();
      // Only a token Firebase says is gone is dropped. A bare 404 is also
      // what a mistyped project id gets, and that must not empty the table.
      if (/UNREGISTERED|registration-token-not-registered/i.test(text)) {
        gone += 1;
        await drop(d.id).catch(() => undefined);
      } else {
        failed.push(`FCM ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    } catch (err) {
      failed.push(err instanceof Error ? err.message.slice(0, 120) : String(err));
    }
  }
  return { sent, gone, failed };
}
