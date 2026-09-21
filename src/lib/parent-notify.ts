import { db } from '@/lib/db';
import { queueNotifications } from '@/lib/notify';
import { pushConfigured, pushToParent } from '@/lib/messaging/push';
import { fcmConfigured, fcmToParent } from '@/lib/messaging/fcm';
import { settingBool } from '@/lib/settings/store';

/**
 * Telling parents something, the one way.
 *
 * Every alert a parent gets goes through here: the inbox row first, which
 * is the record and the dedupe (a key per contact and occasion, written
 * once however many times the cron or a retry asks); then a push to the
 * browsers that asked for it, with the generic lock-screen text; then the
 * message channels the academy has switched on for the event. A row that
 * already existed sends nothing again.
 */

export interface ParentAlert {
  contact: string;
  name: string;
  learnerId: string;
  learnerIds?: string[];
  kind: string;
  title: string;
  body: string;
  href: string;
  dedupeKey: string;
  noticeId?: string;
  /** Per-recipient template variables beyond the shared context. */
  vars?: Record<string, string>;
}

export interface NotifyParentsResult {
  written: number;
  pushed: number;
  queued: number;
}

export async function notifyParents(input: {
  organizationId: string;
  eventKey: string;
  alerts: ParentAlert[];
  context: Record<string, string>;
  /** The lock-screen text, when it must not be the inbox title. Defaults to the title with no detail beyond the child's name. */
  pushBody?: string;
}): Promise<NotifyParentsResult> {
  if (input.alerts.length === 0) return { written: 0, pushed: 0, queued: 0 };
  const { organizationId } = input;

  const created = await db.parentNotification.createMany({
    data: input.alerts.map((a) => ({
      organizationId,
      contact: a.contact,
      learnerId: a.learnerId,
      learnerIds: a.learnerIds ?? [a.learnerId],
      kind: a.kind,
      title: a.title,
      body: a.body,
      href: a.href,
      dedupeKey: a.dedupeKey,
      noticeId: a.noticeId ?? null,
    })),
    skipDuplicates: true,
  });
  if (created.count === 0) return { written: 0, pushed: 0, queued: 0 };

  // Which alerts were new: the rows now carrying these keys, written just now.
  const fresh = await db.parentNotification.findMany({
    where: { organizationId, dedupeKey: { in: input.alerts.map((a) => a.dedupeKey) }, createdAt: { gte: new Date(Date.now() - 60_000) } },
    select: { dedupeKey: true },
  });
  const freshKeys = new Set(fresh.map((f) => f.dedupeKey));
  const live = input.alerts.filter((a) => freshKeys.has(a.dedupeKey));

  let pushed = 0;
  if (await settingBool(organizationId, 'notices.push')) {
    const [web, app] = [pushConfigured(), await fcmConfigured(organizationId)];
    for (const a of live) {
      const payload = { title: a.title, body: input.pushBody ?? 'Open the parent view to read it.', url: a.href, tag: a.dedupeKey };
      if (web) pushed += (await pushToParent(organizationId, a.contact, payload).catch(() => ({ sent: 0 }))).sent;
      if (app) pushed += (await fcmToParent(organizationId, a.contact, payload).catch(() => ({ sent: 0 }))).sent;
    }
  }

  const recipients = live.map((a) => ({ userId: null, email: a.contact.includes('@') ? a.contact : null, phone: a.contact.includes('@') ? null : a.contact }));
  const result = await queueNotifications({
    organizationId,
    eventKey: input.eventKey,
    recipients,
    context: input.context,
    contextFor: (p) => {
      const hit = live.find((a) => (a.contact.includes('@') ? a.contact === p.email : a.contact === p.phone));
      return { name: hit?.name ?? 'Parent', ...(hit?.vars ?? {}) };
    },
  });

  return { written: created.count, pushed, queued: result.queued };
}
