import { requireTenant } from '@/lib/tenant';
import { requireParentSession } from '@/lib/parent-session';
import { parentInboxRows } from '@/lib/parent-inbox-data';
import { pushConfigured } from '@/lib/messaging/push';
import { settingBool } from '@/lib/settings/store';
import { formatDateTime } from '@/lib/clock';
import { Card } from '@/components/ui';
import { ParentInbox, ParentPushToggle, type InboxRow } from './inbox';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notices', robots: { index: false, follow: false } };

/**
 * Everything the academy has told this parent, across their children. A
 * row about a child whose link has since been revoked opens nothing: it
 * is shown as a line with no link, so the history is honest and the door
 * is shut.
 */
export default async function ParentNotices() {
  const tenant = await requireTenant();
  const session = await requireParentSession();
  const [{ rows, unread }, pushOn] = await Promise.all([parentInboxRows(tenant.organizationId, session.contact), settingBool(tenant.organizationId, 'notices.push')]);
  const list: InboxRow[] = rows.map((r) => ({ id: r.id, title: r.title, body: r.body, href: r.href, category: r.category, children: r.children, when: formatDateTime(r.createdAt, tenant.timezone), read: r.read, withdrawn: r.withdrawn }));

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
