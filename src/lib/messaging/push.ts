import webpush from 'web-push';
import { db } from '@/lib/db';

/**
 * Web push, through the browser's own push service, signed with the
 * academy's VAPID keys. The keys live in the environment (VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY, VAPID_SUBJECT as a mailto:), because a key pair is
 * made once and never typed again. `npx web-push generate-vapid-keys` makes
 * one. Without the keys the channel says so and the rows wait.
 */

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function configure() {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@example.com', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Send to every subscription a person holds. A 404 or 410 from the push
 * service means that browser unsubscribed, and the row is dropped rather
 * than retried forever.
 */
export async function pushToUser(organizationId: string, userId: string, payload: PushPayload): Promise<{ sent: number; gone: number; failed: string[] }> {
  if (!pushConfigured()) return { sent: 0, gone: 0, failed: ['Web push keys are not set.'] };
  configure();
  const subs = await db.pushSubscription.findMany({ where: { organizationId, userId }, select: { id: true, endpoint: true, p256dh: true, auth: true } });
  let sent = 0;
  let gone = 0;
  const failed: string[] = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
      sent += 1;
      await db.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        gone += 1;
        await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      } else {
        failed.push(err instanceof Error ? err.message.slice(0, 120) : String(err));
      }
    }
  }
  return { sent, gone, failed };
}
