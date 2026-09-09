import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { getSessionUser } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Badge, Card, EmptyState, LinkButton, ProgressRing } from '@/components/ui';
import { ColumnChart, Meter, type ColumnPoint } from '@/components/chart';
import {
  attendanceRate,
  attentionItems,
  daysAgo,
  startOfDay,
  startOfMonth,
  weeklyCollections,
} from './dashboard-data';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function AdminHome() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  const orgId = tenant.organizationId;

  // Revenue is a permission, not a given. A branch manager sees the operations
  // half of this page and none of the money.
  const canSeeMoney = user?.permissions['dashboard.view_revenue_widgets']?.view ?? false;

  const monthStart = startOfMonth();
  const lastMonthStart = startOfMonth(-1);
  const dayStart = startOfDay();
  const dayEnd = new Date(dayStart.getTime() + 864e5);

  const [
    thisMonthMoney,
    lastMonthMoney,
    thisMonthEnrolments,
    lastMonthEnrolments,
    learners,
    activeLearners,
    weekly,
    attendance,
    attention,
    todaySessions,
    recent,
    topCourses,
    catalogue,
  ] = await Promise.all([
    db.payment.aggregate({
      where: { organizationId: orgId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] }, createdAt: { gte: monthStart } },
      _sum: { amountPaise: true },
      _count: true,
    }),
    db.payment.aggregate({
      where: {
        organizationId: orgId,
        status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] },
        createdAt: { gte: lastMonthStart, lt: monthStart },
      },
      _sum: { amountPaise: true },
    }),
    db.enrollment.count({ where: { organizationId: orgId, createdAt: { gte: monthStart } } }),
    db.enrollment.count({
      where: { organizationId: orgId, createdAt: { gte: lastMonthStart, lt: monthStart } },
    }),
    db.user.count({ where: { organizationId: orgId, kind: 'LEARNER', deletedAt: null } }),
    db.enrollment.count({
      where: { organizationId: orgId, lastActivityAt: { gte: daysAgo(30) } },
    }),
    weeklyCollections(orgId),
    attendanceRate(orgId, daysAgo(30)),
    attentionItems(orgId),
    db.liveSession.findMany({
      where: {
        organizationId: orgId,
        startsAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        title: true,
        startsAt: true,
        status: true,
        batch: { select: { name: true } },
        _count: { select: { attendances: true } },
      },
    }),
    db.enrollment.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        progressPercent: true,
        createdAt: true,
        user: { select: { name: true } },
        product: { select: { title: true } },
      },
    }),
    db.product.findMany({
      where: { organizationId: orgId, type: 'COURSE', deletedAt: null },
      orderBy: { enrollments: { _count: 'desc' } },
      take: 5,
      select: { id: true, title: true, status: true, _count: { select: { enrollments: true } } },
    }),
    Promise.all([
      db.product.count({ where: { organizationId: orgId, type: 'COURSE', status: 'PUBLISHED', deletedAt: null } }),
      db.batch.count({ where: { organizationId: orgId, status: 'ACTIVE', deletedAt: null } }),
    ]),
  ]);

  const [publishedCourses, activeBatches] = catalogue;

  const collected = thisMonthMoney._sum.amountPaise ?? 0;
  const collectedLast = lastMonthMoney._sum.amountPaise ?? 0;
  const moneyDelta = deltaPercent(collected, collectedLast);
  const enrolDelta = deltaPercent(thisMonthEnrolments, lastMonthEnrolments);

  const chart: ColumnPoint[] = weekly.map((w) => ({
    label: `Week of ${w.start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
    axisLabel: w.start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    value: w.paise / 100,
    display: formatMoney(w.paise, tenant.currency),
  }));

  const firstName = user?.name.split(' ')[0] ?? 'there';
  const signedInToday = todaySessions.reduce((n, s) => n + s._count.attendances, 0);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-display">
            Good {partOfDay()}, {firstName}
          </h1>
          <p className="t-small muted mt-1">
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            {' · '}
            {tenant.name}
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/admin/sessions" variant="secondary" size="sm">
            Today&rsquo;s classes
          </LinkButton>
          <LinkButton href="/admin/courses/new" size="sm">
            New course
          </LinkButton>
        </div>
      </div>

      {/* The one number the page leads with. Exactly one hero figure per view. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="flex flex-col justify-between">
          {canSeeMoney ? (
            <>
              <div>
                <p className="t-micro faint uppercase tracking-wide">Collected this month</p>
                <p className="mt-2 text-5xl font-semibold leading-none tracking-tight">
                  {formatMoney(collected, tenant.currency)}
                </p>
                <p className="t-small mt-2">
                  {moneyDelta === null ? (
                    <span className="faint">No comparison for last month yet</span>
                  ) : (
                    <>
                      <span
                        className="font-medium tabular-nums"
                        style={{ color: moneyDelta >= 0 ? 'var(--ok)' : 'var(--bad)' }}
                      >
                        {moneyDelta >= 0 ? '↑' : '↓'} {Math.abs(moneyDelta)}%
                      </span>{' '}
                      <span className="faint">
                        against {formatMoney(collectedLast, tenant.currency)} last month
                      </span>
                    </>
                  )}
                </p>
              </div>
              <p className="t-small faint mt-6 border-t pt-4">
                Money actually received and confirmed by the gateway, across{' '}
                {thisMonthMoney._count} payment{thisMonthMoney._count === 1 ? '' : 's'}. Not
                invoiced value, and not recognised revenue.
              </p>
            </>
          ) : (
            <>
              <div>
                <p className="t-micro faint uppercase tracking-wide">Enrolments this month</p>
                <p className="mt-2 text-5xl font-semibold leading-none tracking-tight tabular-nums">
                  {thisMonthEnrolments}
                </p>
              </div>
              <p className="t-small faint mt-6 border-t pt-4">
                Revenue figures are not part of your role.
              </p>
            </>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="t-heading">
              {canSeeMoney ? 'Collections, last twelve weeks' : 'Activity, last twelve weeks'}
            </h2>
            <span className="t-small faint">weekly</span>
          </div>
          {canSeeMoney ? (
            <ColumnChart points={chart} emptyMessage="No payments have been received yet." />
          ) : (
            <p className="t-small faint">Revenue figures are not part of your role.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Enrolments this month"
          value={String(thisMonthEnrolments)}
          delta={enrolDelta}
          sub={`${lastMonthEnrolments} last month`}
        />
        <Tile
          label="Learners"
          value={learners.toLocaleString('en-IN')}
          sub={`${activeLearners} active in the last 30 days`}
          meter={{ value: activeLearners, max: Math.max(learners, 1) }}
        />
        <Tile
          label="Attendance, last 30 days"
          value={attendance.expected ? `${attendance.percent}%` : '—'}
          sub={
            attendance.expected
              ? `${attendance.present} of ${attendance.expected} expected across ${attendance.sessions} classes`
              : 'No classes held in this period'
          }
          meter={
            attendance.expected
              ? {
                  value: attendance.percent,
                  max: 100,
                  tone: attendance.percent >= 75 ? 'ok' : attendance.percent >= 50 ? 'warn' : 'bad',
                }
              : undefined
          }
        />
        <Tile
          label="Catalogue"
          value={String(publishedCourses)}
          sub={`published courses · ${activeBatches} active batches`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="t-heading">Today</h2>
              <span className="t-small faint">
                {todaySessions.length
                  ? `${signedInToday} sign-in${signedInToday === 1 ? '' : 's'} so far`
                  : ''}
              </span>
            </div>

            {todaySessions.length === 0 ? (
              <EmptyState
                title="No classes today"
                hint="Schedule a weekly series and it appears here on the day it runs."
                action={
                  <LinkButton href="/admin/sessions" size="sm" variant="secondary">
                    Open the schedule
                  </LinkButton>
                }
              />
            ) : (
              <Card padded={false}>
                <ul className="divide-y">
                  {todaySessions.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/admin/sessions/${s.id}`}
                        className="flex items-center gap-4 px-5 py-3 hover:bg-[var(--surface-2)]"
                      >
                        <span className="t-small w-16 shrink-0 tabular-nums font-medium">
                          {s.startsAt.toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{s.title}</span>
                          <span className="t-small faint block truncate">{s.batch.name}</span>
                        </span>
                        {s.status === 'CANCELLED' ? (
                          <Badge tone="bad">cancelled</Badge>
                        ) : (
                          <span className="t-small faint shrink-0 tabular-nums">
                            {s._count.attendances} in
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="t-heading">Recent enrolments</h2>
              <Link href="/admin/learners" className="t-small faint hover:underline">
                All learners
              </Link>
            </div>

            {recent.length === 0 ? (
              <EmptyState
                title="No enrolments yet"
                hint="Publish a course and share the link, or enrol someone from the admin."
              />
            ) : (
              <Card padded={false}>
                <ul className="divide-y">
                  {recent.map((e) => (
                    <li key={e.id} className="flex items-center gap-4 px-5 py-3">
                      <ProgressRing value={e.progressPercent} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{e.user.name}</p>
                        <p className="t-small faint truncate">{e.product.title}</p>
                      </div>
                      <span className="t-small faint shrink-0">
                        {e.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section>
            <h2 className="t-heading mb-3">Needs attention</h2>

            {attention.length === 0 ? (
              <Card>
                <p className="text-sm font-medium">Nothing waiting</p>
                <p className="t-small muted mt-1">
                  Every published course is priced, no checkout is stuck, every recent class has
                  sign-ins, and no lesson is empty.
                </p>
              </Card>
            ) : (
              <Card padded={false}>
                <ul className="divide-y">
                  {attention.map((a) => (
                    <li key={a.id}>
                      <Link href={a.href} className="block px-5 py-4 hover:bg-[var(--surface-2)]">
                        <span className="flex items-start gap-2.5">
                          <span
                            aria-hidden
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                            style={{ background: `var(--${a.tone === 'bad' ? 'bad' : 'warn'})` }}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{a.title}</span>
                            <span className="t-small muted mt-0.5 block">{a.detail}</span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          <section>
            <h2 className="t-heading mb-3">Courses by enrolment</h2>
            {topCourses.length === 0 ? (
              <Card>
                <p className="t-small muted">No courses yet.</p>
              </Card>
            ) : (
              <Card padded={false}>
                <ul className="divide-y">
                  {topCourses.map((c) => {
                    const top = topCourses[0]._count.enrollments || 1;
                    return (
                      <li key={c.id} className="px-5 py-3">
                        <Link href={`/admin/courses/${c.id}`} className="block">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-sm hover:underline">{c.title}</span>
                            <span className="t-small shrink-0 tabular-nums">
                              {c._count.enrollments}
                            </span>
                          </span>
                          <span className="mt-2 block">
                            <Meter value={c._count.enrollments} max={top} />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* Pieces ------------------------------------------------------------------ */

function Tile({
  label,
  value,
  sub,
  delta,
  meter,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  meter?: { value: number; max: number; tone?: 'brand' | 'ok' | 'warn' | 'bad' };
}) {
  return (
    <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-sm">
      <p className="t-micro faint uppercase tracking-wide">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        {delta != null && (
          <span
            className="t-small font-medium tabular-nums"
            style={{ color: delta >= 0 ? 'var(--ok)' : 'var(--bad)' }}
          >
            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%
          </span>
        )}
      </div>
      {meter && (
        <div className="mt-3">
          <Meter value={meter.value} max={meter.max} tone={meter.tone} />
        </div>
      )}
      {sub && <p className="t-small faint mt-2">{sub}</p>}
    </div>
  );
}

function deltaPercent(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

function partOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
