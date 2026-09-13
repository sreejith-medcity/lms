import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatDateTime } from '@/lib/clock';
import { pushConfigured } from '@/lib/messaging/push';
import { EmptyState } from '@/components/ui';
import { Inbox, PushToggle } from './inbox';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications' };

/**
 * Everything the academy has told this person inside the product, newest
 * first, with the unread ones marked. The same messages that went out by
 * email or WhatsApp, so a learner who lost the email still has the note.
 */
export default async function NotificationsPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const rows = await db.notificationLog.findMany({
    where: { organizationId: tenant.organizationId, userId: user.id, channel: 'IN_APP', status: { in: ['SENT', 'READ'] } },
    orderBy: { sentAt: 'desc' },
    take: 100,
    select: { id: true, eventKey: true, status: true, sentAt: true, createdAt: true, context: true },
  });

  const items = rows.map((r) => {
    const c = (r.context ?? {}) as Record<string, string>;
    const url = typeof c.url === 'string' && c.url.startsWith('/') ? c.url : null;
    return {
      id: r.id,
      title: c._renderedSubject || r.eventKey,
      body: c._renderedBody || '',
      url,
      unread: r.status === 'SENT',
      when: formatDateTime(r.sentAt ?? r.createdAt, tenant.timezone),
    };
  });

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="t-small faint mt-1">{items.filter((i) => i.unread).length} unread</p>
        </div>
        <PushToggle available={pushConfigured()} />
      </div>
      {items.length === 0 ? <EmptyState title="Nothing yet" hint="Class reminders, marks, receipts and announcements land here as they happen." /> : <Inbox items={items} />}
    </div>
  );
}
