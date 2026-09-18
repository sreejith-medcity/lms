import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { batchWhere, branchWhere, enrollmentWhere, scopeNote, sessionWhere, staffScope } from '@/lib/scope';
import { activeStaffWhere } from '@/lib/scope-rules';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { formatMoney } from '@/lib/money';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The Branch Head's desk: what needs a decision or a chase in their
 * branch today. Approvals waiting, registers not kept, learners missing
 * class in a row, batches with nobody assigned, fees overdue, and the
 * doors to notices and reports. Head Office sees the same for the branch
 * it has switched to, or for the academy.
 */
export default async function BranchDesk() {
  const tenant = await requireTenant();
  const me = await requireStaff();
  const scope = await staffScope(me);
  const tz = tenant.timezone;
  const canSeeFees = Boolean(me.permissions['sales.fee_tracking']?.view);
  const canApprove = Boolean(me.permissions['courses.assessments']?.edit) && scope.kind !== 'batches';
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const monthAgo = new Date(now.getTime() - 30 * 864e5);

  const [branches, waiting, registersMissing, recentAbsences, batches, overdue, notices] = await Promise.all([
    db.branch.findMany({ where: { organizationId: tenant.organizationId, isActive: true, ...branchWhere(scope) }, select: { id: true, name: true, headUserId: true, deputyUserId: true } }),
    canApprove
      ? db.markSheet.findMany({ where: { organizationId: tenant.organizationId, status: 'SUBMITTED', batch: batchWhere(scope) }, orderBy: { submittedAt: 'asc' }, take: 8, select: { id: true, title: true, submittedAt: true, batch: { select: { name: true } } } })
      : Promise.resolve([]),
    db.liveSession.findMany({
      where: { organizationId: tenant.organizationId, status: { in: ['COMPLETED', 'LIVE'] }, isHoliday: false, endsAt: { gte: weekAgo, lte: now }, batchId: { not: null }, registerSubmittedAt: null, ...sessionWhere(scope) },
      orderBy: { startsAt: 'desc' },
      take: 40,
      select: { id: true, title: true, startsAt: true, batch: { select: { name: true, _count: { select: { enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED'] } } } } } } }, _count: { select: { attendances: true } } },
    }),
    db.attendance.findMany({
      where: { status: 'ABSENT', session: { organizationId: tenant.organizationId, startsAt: { gte: monthAgo }, ...sessionWhere(scope) } },
      select: { userId: true, session: { select: { startsAt: true, batchId: true, batch: { select: { name: true } } } }, user: { select: { name: true } } },
    }),
    db.batch.findMany({
      where: { organizationId: tenant.organizationId, deletedAt: null, status: { in: ['ACTIVE', 'UPCOMING'] }, ...batchWhere(scope) },
      select: { id: true, name: true, staff: { where: { role: 'PRIMARY_TUTOR', ...activeStaffWhere(now) }, select: { userId: true } } },
    }),
    canSeeFees
      ? db.instalment.findMany({
          where: { dueDate: { lt: now }, paidAt: null, enrollment: { organizationId: tenant.organizationId, status: { in: ['ENROLLED', 'ON_LEAVE'] }, ...enrollmentWhere(scope) } },
          select: { amountPaise: true, paidPaise: true, enrollment: { select: { userId: true } } },
        })
      : Promise.resolve([]),
    db.announcement.count({ where: { organizationId: tenant.organizationId, publishAt: { gte: weekAgo } } }),
  ]);

  // Registers still open only where somebody is actually unrecorded.
  const missing = registersMissing.filter((s) => s._count.attendances < (s.batch?._count.enrollments ?? 0));

  // Three or more absences in a row per learner, counted back from the latest class.
  const absencesBy = new Map<string, { name: string; batch: string; count: number }>();
  for (const a of recentAbsences) {
    const r = absencesBy.get(a.userId) ?? { name: a.user.name, batch: a.session.batch?.name ?? '', count: 0 };
    r.count += 1;
    absencesBy.set(a.userId, r);
  }
  const exceptions = [...absencesBy.entries()].filter(([, r]) => r.count >= 3).sort((a, b) => b[1].count - a[1].count).slice(0, 12);

  const unassigned = batches.filter((b) => b.staff.length === 0);
  const overduePaise = overdue.reduce((n, i) => n + Math.max(0, i.amountPaise - i.paidPaise), 0);
  const overdueLearners = new Set(overdue.filter((i) => i.amountPaise - i.paidPaise > 0).map((i) => i.enrollment.userId)).size;
  const headIds = branches.flatMap((b) => [b.headUserId, b.deputyUserId]).filter((x): x is string => Boolean(x));
  const names = headIds.length ? new Map((await db.user.findMany({ where: { id: { in: headIds }, organizationId: tenant.organizationId }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map<string, string>();
  const note = scopeNote(scope);

  return (
    <div>
      <PageHeader
        title={scope.kind === 'all' ? 'Branches' : branches.length === 1 ? branches[0].name : 'Your branches'}
        description={`What needs a decision or a chase.${note ? ` ${note}` : ' The whole academy; pick a branch at the top right to see it as its head would.'}`}
      />

      <div className="mb-6">
        <StatGrid>
          <Stat label="Waiting for approval" value={String(waiting.length)} sub={canApprove ? 'mark sheets' : 'approved by the Branch Head'} />
          <Stat label="Registers not confirmed" value={String(missing.length)} sub="classes in the last 7 days" />
          <Stat label="Missing class in a row" value={String(exceptions.length)} sub="3 or more absences, 30 days" />
          {canSeeFees ? <Stat label="Overdue" value={formatMoney(overduePaise, tenant.currency)} sub={`${overdueLearners} learner${overdueLearners === 1 ? '' : 's'}`} /> : <Stat label="Batches without a teacher" value={String(unassigned.length)} />}
        </StatGrid>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {canApprove && (
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="t-heading">Approvals</h2>
              <Link href="/admin/approvals" className="t-small underline">
                All
              </Link>
            </div>
            {waiting.length === 0 ? (
              <p className="t-small faint mt-2">Nothing waiting.</p>
            ) : (
              <ul className="mt-2 divide-y">
                {waiting.map((w) => (
                  <li key={w.id} className="py-2 text-sm">
                    <Link href={`/admin/marksheets/${w.id}`} className="hover:underline">
                      {w.title}
                    </Link>
                    <span className="faint">
                      {' '}
                      · {w.batch.name} · since {w.submittedAt ? formatDayLabel(dayKey(w.submittedAt, tz), tz) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="t-heading">Registers not confirmed</h2>
            <Link href="/admin/register" className="t-small underline">
              Register
            </Link>
          </div>
          {missing.length === 0 ? (
            <p className="t-small faint mt-2">Every class in the last week has its register.</p>
          ) : (
            <ul className="mt-2 divide-y">
              {missing.slice(0, 10).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/admin/register/${s.id}`} className="min-w-0 truncate hover:underline">
                    {s.title} <span className="faint">· {s.batch?.name}</span>
                  </Link>
                  <span className="t-micro faint shrink-0 tabular-nums">
                    {formatDayLabel(dayKey(s.startsAt, tz), tz)} · {s._count.attendances} of {s.batch?._count.enrollments}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="t-heading">Missing class in a row</h2>
          {exceptions.length === 0 ? (
            <p className="t-small faint mt-2">Nobody has three or more absences in the last 30 days.</p>
          ) : (
            <ul className="mt-2 divide-y">
              {exceptions.map(([userId, r]) => (
                <li key={userId} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/admin/learners/${userId}`} className="min-w-0 truncate hover:underline">
                    {r.name} <span className="faint">· {r.batch}</span>
                  </Link>
                  <Badge tone="bad">{r.count} absent</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="t-heading">Assignments</h2>
          {unassigned.length === 0 ? (
            <p className="t-small faint mt-2">Every running batch has a teacher assigned today.</p>
          ) : (
            <ul className="mt-2 divide-y">
              {unassigned.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/admin/batches/${b.id}`} className="hover:underline">
                    {b.name}
                  </Link>
                  <Badge tone="warn">no teacher</Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="t-small faint mt-3">
            {branches.map((b) => `${b.name}: ${b.headUserId ? names.get(b.headUserId) : 'no head named'}${b.deputyUserId ? ` (deputy ${names.get(b.deputyUserId)})` : ''}`).join(' · ')}
          </p>
        </Card>

        <Card>
          <h2 className="t-heading">Reports and notices</h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li>
              <Link href="/admin/analytics/reports/attendance-completion" className="underline">
                Registers: kept, missing, exceptions
              </Link>
            </li>
            <li>
              <Link href="/admin/analytics/reports/academic-monitoring" className="underline">
                Results through approval
              </Link>
            </li>
            <li>
              <Link href="/admin/analytics/reports/progress-by-batch" className="underline">
                Progress by batch
              </Link>
            </li>
            {canSeeFees && (
              <li>
                <Link href="/admin/analytics/reports/fees-by-branch" className="underline">
                  Fees owed, by branch and batch
                </Link>
              </li>
            )}
            <li>
              <Link href="/admin/announcements" className="underline">
                Notices
              </Link>
              <span className="faint"> · {notices} in the last week</span>
            </li>
            {canSeeFees && (
              <li>
                <Link href="/admin/fees" className="underline">
                  Fees
                </Link>
              </li>
            )}
          </ul>
        </Card>
      </div>
      {branches.length === 0 && <EmptyState title="No branch in your scope" hint="Ask Head Office to add you to a branch." />}
    </div>
  );
}
