import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { childrenOf, requireParentSession } from '@/lib/parent-session';
import { maskContact } from '@/lib/parents';
import { settingNumber } from '@/lib/settings/store';
import { formatDateTime } from '@/lib/clock';
import { signOutParent } from '@/server/parent';
import { signOutParentEverywhere } from '@/server/parent-inbox';
import { Badge, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your account', robots: { index: false, follow: false } };

function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/iPhone|iPad/.test(ua)) return 'iPhone or iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Windows/.test(ua)) return 'Windows computer';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'Browser';
}

/**
 * The parent's own account: the contact they signed in with, the children
 * on it, every device signed in, and the lost-phone button. Nothing about a
 * child is changed here; that is the office's.
 */
export default async function ParentAccount() {
  const tenant = await requireTenant();
  const session = await requireParentSession();
  const [children, sessions, days] = await Promise.all([
    childrenOf(tenant.organizationId, session.contact),
    db.parentSession.findMany({ where: { organizationId: tenant.organizationId, contact: session.contact, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: 'desc' }, select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, userAgent: true } }),
    settingNumber(tenant.organizationId, 'auth.parentSessionDays'),
  ]);
  const pushDevices = await db.parentPushSubscription.count({ where: { organizationId: tenant.organizationId, contact: session.contact } });

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <h1 className="text-xl font-semibold">Your account</h1>
      <p className="t-small faint mt-1">Signed in as {maskContact(session.contact)}.</p>

      <div className="mt-5 space-y-4">
        <Card>
          <h2 className="t-heading">Children on this account</h2>
          {children.length === 0 ? (
            <p className="t-small faint mt-2">None linked. The office links a parent&rsquo;s contact to a learner at admission.</p>
          ) : (
            <ul className="mt-2 divide-y">
              {children.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/parent/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  {c.registrationNo && <span className="t-small faint">Reg. {c.registrationNo}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="t-micro faint mt-2">To add or remove a child, or change the contact, speak to the branch office. Nothing here changes a learner&rsquo;s record.</p>
        </Card>

        <Card>
          <h2 className="t-heading">Devices signed in</h2>
          <ul className="mt-2 divide-y">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p>
                    {deviceLabel(s.userAgent)}
                    {s.id === session.id && <Badge tone="ok"> this device</Badge>}
                  </p>
                  <p className="t-micro faint">Signed in {formatDateTime(s.createdAt, tenant.timezone)} · last used {formatDateTime(s.lastSeenAt, tenant.timezone)}</p>
                </div>
                <span className="t-micro faint">signs out by itself {formatDateTime(s.expiresAt, tenant.timezone)}</span>
              </li>
            ))}
          </ul>
          <p className="t-small faint mt-2">
            A device stays signed in for {days} days, then asks for a code again. {pushDevices > 0 ? `${pushDevices} device${pushDevices === 1 ? '' : 's'} receive${pushDevices === 1 ? 's' : ''} push.` : ''}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={signOutParent}>
              <button type="submit" className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">
                Sign out this device
              </button>
            </form>
            <form action={signOutParentEverywhere}>
              <button type="submit" className="rounded-[var(--radius-sm)] border border-[var(--bad)] px-3 py-1.5 text-sm text-[var(--bad)] hover:bg-[var(--surface-2)]">
                Lost a phone? Sign out everywhere
              </button>
            </form>
          </div>
          <p className="t-micro faint mt-2">Sign out everywhere ends every session, including this one, and stops push on every device. Nothing about your children stays readable on a signed-out phone.</p>
        </Card>
      </div>
    </div>
  );
}
