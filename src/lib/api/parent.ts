import { headers } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { getTenantContext, type TenantContext } from '@/lib/tenant';
import { settingNumber } from '@/lib/settings/store';
import { readAccessToken, signAccessToken } from './tokens';

/**
 * A parent on the app.
 *
 * The access token names the contact and the academy, for an hour. The
 * refresh token is a `ParentSession` row, the same row the web parent
 * view uses, so the account page's "sign out everywhere" and the
 * office's Devices page cover the phone too, with nothing extra to
 * revoke. A parent is a contact, not a User, so nothing here touches the
 * user or api_tokens tables.
 */

export interface ApiParent {
  contact: string;
  sessionId: string;
}

export async function bearerParent(request: Request): Promise<{ tenant: TenantContext; parent: ApiParent } | null> {
  const tenant = await getTenantContext();
  if (!tenant) return null;
  const header = request.headers.get('authorization') ?? (await headers()).get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const claims = readAccessToken(header.slice(7).trim());
  if (!claims || claims.org !== tenant.organizationId || claims.kind !== 'PARENT') return null;
  // The session behind the token must still exist: a parent signed out
  // everywhere loses the phone at the next request, not the next hour.
  const sid = request.headers.get('x-parent-session') ?? '';
  const session = sid
    ? await db.parentSession.findFirst({ where: { id: sid, organizationId: tenant.organizationId, contact: claims.sub, expiresAt: { gt: new Date() } }, select: { id: true } })
    : await db.parentSession.findFirst({ where: { organizationId: tenant.organizationId, contact: claims.sub, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: 'desc' }, select: { id: true } });
  if (!session) return null;
  return { tenant, parent: { contact: claims.sub, sessionId: session.id } };
}

export interface ParentTokens {
  accessToken: string;
  accessExpiresIn: number;
  refreshToken: string;
  refreshExpiresAt: string;
  sessionId: string;
}

export async function issueParentTokens(organizationId: string, contact: string, device: string | null): Promise<ParentTokens> {
  const token = randomBytes(32).toString('base64url');
  const days = await settingNumber(organizationId, 'auth.parentSessionDays').catch(() => 30);
  const expiresAt = new Date(Date.now() + Math.max(1, days || 30) * 864e5);
  const row = await db.parentSession.create({ data: { organizationId, contact, token, expiresAt, userAgent: device ? `app: ${device}`.slice(0, 300) : 'app' }, select: { id: true } });
  return { accessToken: signAccessToken({ sub: contact, org: organizationId, kind: 'PARENT' }), accessExpiresIn: 3600, refreshToken: token, refreshExpiresAt: expiresAt.toISOString(), sessionId: row.id };
}

/** A fresh access token off a live refresh token; the session row stays, its last-seen moves. */
export async function refreshParentTokens(organizationId: string, refreshToken: string): Promise<ParentTokens | null> {
  const row = await db.parentSession.findFirst({ where: { token: refreshToken, organizationId }, select: { id: true, contact: true, expiresAt: true } });
  if (!row || row.expiresAt < new Date()) return null;
  await db.parentSession.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
  return { accessToken: signAccessToken({ sub: row.contact, org: organizationId, kind: 'PARENT' }), accessExpiresIn: 3600, refreshToken, refreshExpiresAt: row.expiresAt.toISOString(), sessionId: row.id };
}

export async function revokeParentToken(organizationId: string, refreshToken: string): Promise<void> {
  await db.parentSession.deleteMany({ where: { token: refreshToken, organizationId } });
}
