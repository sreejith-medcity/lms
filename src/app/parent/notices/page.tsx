import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { childrenOf, requireParentSession } from '@/lib/parent-session';
import { pushConfigured } from '@/lib/messaging/push';
import { settingBool } from '@/lib/settings/store';
import { formatDateTime } from '@/lib/clock';
import { noticeCategory } from '@/lib/notices';
import { Card } from '@/components/ui';
import { ParentInbox, ParentPushToggle, type InboxRow } from './inbox';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notices', robots: { index: false, follow: false } };

const KIND_CATEGORY: Record<string, string> = {
  'attendance.absent': 'Attendance',
  'attendance.late': 'Attendance',
  'attendance.corrected': 'Attendance',
  'result.published': 'Result',
  'fee.reminder': 'Fees',
};

/**
 * Everything the academy has told this parent, across their children. A
 * row about a child whose link has since been revoked opens nothing: it
 * is shown as a line with no link, so the history is honest and the door
 * is shut.
 */
export default async function ParentNotices() {
  const tenant = await requireTenant();
  const session = await requireParentSession();
  const children = await childrenOf(tenant.organizationId, session.contact);
  const childName = new Map(children.map((c) => [c.id, c.name]));

  const [rows, pushOn] = await Promise.all([
    db.parentNotification.findMany({
      where: { organizationId: tenant.organizationId, contact: session.contact },
      orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
      select: { id: true, kind: true, title: true, body: true, href: true, readAt: true, createdAt: true, learnerId: true, learnerIds: true, noticeId: true },
    }),
    settingBool(tenant.organizationId, 'notices.push'),
  ]);

  const noticeIds = rows.map((r) => r.noticeId).filter((x): x is string => Boolean(x));
  const notices = noticeIds.length ? await db.notice.findMany({ where: { organizationId: tenant.organizationId, id: { in: noticeIds } }, select: { id: true, kind: true, status: true } }) : [];
  const noticeById = new Map(notices.map((n) => [n.id, n]));

  const list: InboxRow[] = rows.map((r) => {
    const ids = r.learnerIds.length ? r.learnerIds : [r.learnerId];
    const linked = ids.filter((id) => childName.has(id));
    const notice = r.noticeId ? noticeById.get(r.noticeId) : null;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      // A child no longer linked opens nothing.
      href: linked.length === 0 ? null : r.href,
      category: notice ? noticeCategory(notice.kind) : (KIND_CATEGORY[r.kind] ?? 'Notice'),
      children: linked.length === 0 ? 'a child no longer on your account' : linked.map((id) => childName.get(id)).join(', '),
      when: formatDateTime(r.createdAt, tenant.timezone),
      read: r.readAt !== null,
      withdrawn: notice?.status === 'WITHDRAWN',
    };
  });
  const unread = list.filter((r) => !r.read).length;

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <h1 className="text-xl font-semibold">Notices</h1>
      <p className="t-small faint mt-1">Notices from the academy, attendance alerts, published results and fee reminders, for all your children in one place.</p>
      <div className="mt-5 space-y-4">
        <Card>
          <ParentInbox rows={list} unread={unread} />
        </Card>
        <Card>
          <h2 className="t-heading">Push on this phone</h2>
          <div className="mt-2">
            <ParentPushToggle available={pushConfigured() && pushOn} />
          </div>
        </Card>
      </div>
    </div>
  );
}
