import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/tenant';
import { childrenOf, getParentSession } from '@/lib/parent-session';
import { childOverview } from '@/lib/parent-data';
import { attendanceNote, maskContact } from '@/lib/parents';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/clock';
import { signOutParent } from '@/server/parent';
import { Badge, Card, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Parent view', robots: { index: false, follow: false } };

/**
 * The children on this contact, one card each with the four things a
 * parent asks: is she going, is anything owed, when is the next class, how
 * did the last test go.
 */
export default async function ParentHome() {
  const tenant = await requireTenant();
  const session = await getParentSession();
  if (!session) redirect('/parent/login');

  const children = await childrenOf(tenant.organizationId, session.contact);
  const overviews = await Promise.all(children.map((c) => childOverview(tenant.organizationId, c.id)));

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{children.length === 1 ? children[0].name : 'Your children'}</h1>
          <p className="t-small faint mt-1">Signed in as {maskContact(session.contact)}. What you see here is what the academy has on record; to change anything, speak to the office.</p>
        </div>
        <form action={signOutParent}>
          <button type="submit" className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">Sign out</button>
        </form>
      </div>

      <div className="mt-6 space-y-4">
        {children.length === 0 ? (
          <EmptyState
            title="No learner has this contact on record"
            hint="The academy writes a parent's number or email on the learner's record at admission. Ask the office to add yours, then sign in again."
          />
        ) : (
          children.map((child, i) => {
            const o = overviews[i];
            return (
              <Card key={child.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/parent/${child.id}`} className="text-lg font-semibold hover:underline">{child.name}</Link>
                    {child.registrationNo && <p className="t-small faint">Registration no. {child.registrationNo}</p>}
                  </div>
                  <Link href={`/parent/${child.id}`} className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">
                    See everything
                  </Link>
                </div>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="t-micro faint">Attendance, last 30 days</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{o.attendance.percent === null ? '—' : `${o.attendance.percent}%`}</dd>
                    <dd className="t-small muted">{attendanceNote(o.attendance)}</dd>
                  </div>
                  <div>
                    <dt className="t-micro faint">Fees</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{o.feesOpenPaise > 0 ? formatMoney(o.feesOpenPaise, tenant.currency) : 'Paid up'}</dd>
                    <dd className="t-small muted">{o.feesOverduePaise > 0 ? <Badge tone="bad">{formatMoney(o.feesOverduePaise, tenant.currency)} overdue</Badge> : o.feesOpenPaise > 0 ? 'to come, nothing overdue' : 'nothing owed'}</dd>
                  </div>
                  <div>
                    <dt className="t-micro faint">Next class</dt>
                    <dd className="mt-1 text-lg font-semibold">{o.nextClassAt ? formatDateTime(o.nextClassAt, tenant.timezone) : '—'}</dd>
                    <dd className="t-small muted">{o.nextClassAt ? 'on the academy timetable' : 'nothing scheduled'}</dd>
                  </div>
                  <div>
                    <dt className="t-micro faint">Last test</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{o.latestMark ? (o.latestMark.scorePercent === null ? 'Being marked' : `${Math.round(o.latestMark.scorePercent)}%`) : '—'}</dd>
                    <dd className="t-small muted">{o.latestMark ? o.latestMark.title : 'no tests yet'}</dd>
                  </div>
                </dl>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
