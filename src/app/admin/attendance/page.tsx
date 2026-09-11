import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { Meter } from '@/components/chart';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Attendance across every batch, and the learners it should worry you about.
 *
 * The register itself lives on each class. This page exists for the question a
 * register cannot answer: who is quietly disappearing. Sorted worst first,
 * because a list of your best attenders changes nothing.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireTenant();
  await requireStaff('scheduling.sessions', 'view');

  const sp = await searchParams;
  const days = Number((Array.isArray(sp.days) ? sp.days[0] : sp.days) ?? 30) || 30;

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const sessions = await db.liveSession.findMany({
    where: {
      organizationId: tenant.organizationId,
      startsAt: { gte: since, lte: new Date() },
      status: { not: 'CANCELLED' },
    },
    orderBy: { startsAt: 'desc' },
    select: {
      id: true,
      title: true,
      startsAt: true,
      batchId: true,
      batch: { select: { name: true } },
      learner: { select: { name: true } },
      attendances: { select: { userId: true, status: true } },
    },
  });

  // A one-to-one class has no batch, so it has no roster to measure against.
  // Those sessions are counted on the learner's own page rather than here.
  const batchIds = [...new Set(sessions.map((s) => s.batchId).filter((id): id is string => Boolean(id)))];

  const roster = await db.enrollment.findMany({
    where: {
      organizationId: tenant.organizationId,
      batchId: { in: batchIds },
      status: { in: ['ENROLLED', 'COMPLETED'] },
    },
    select: {
      batchId: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  });

  const sizeOf = new Map<string, number>();
  for (const r of roster) {
    if (r.batchId) sizeOf.set(r.batchId, (sizeOf.get(r.batchId) ?? 0) + 1);
  }

  // Per learner: how many of their batch's classes they turned up to.
  const attended = new Map<string, number>();
  const owed = new Map<string, number>();

  for (const s of sessions) {
    const present = new Set(
      s.attendances.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').map((a) => a.userId),
    );
    for (const r of roster) {
      if (r.batchId !== s.batchId) continue;
      owed.set(r.user.id, (owed.get(r.user.id) ?? 0) + 1);
      if (present.has(r.user.id)) attended.set(r.user.id, (attended.get(r.user.id) ?? 0) + 1);
    }
  }

  const learners = [...new Map(roster.map((r) => [r.user.id, r.user])).values()]
    .map((u) => {
      const expected = owed.get(u.id) ?? 0;
      const came = attended.get(u.id) ?? 0;
      return {
        ...u,
        expected,
        came,
        percent: expected > 0 ? Math.round((came / expected) * 100) : null,
      };
    })
    .filter((l) => l.expected > 0)
    .sort((a, b) => (a.percent ?? 100) - (b.percent ?? 100));

  // A one-to-one class expects exactly one person, which is the honest
  // denominator for it: counting it as a batch of nobody would drag the
  // academy's attendance rate down every time a trainer takes one.
  const rosterSize = (s: { batchId: string | null }) =>
    s.batchId ? (sizeOf.get(s.batchId) ?? 0) : 1;

  const expectedTotal = sessions.reduce((n, s) => n + rosterSize(s), 0);
  const presentTotal = sessions.reduce(
    (n, s) => n + s.attendances.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length,
    0,
  );
  const atRisk = learners.filter((l) => (l.percent ?? 100) < 60);

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Across every batch. The register for one class lives on that class; this is the view that answers who is quietly disappearing."
        action={
          <div className="flex gap-1">
            {[30, 90].map((d) => (
              <Link
                key={d}
                href={`/admin/attendance?days=${d}`}
                className={`rounded-full border px-3 py-1 text-[0.8125rem] ${
                  days === d ? 'border-transparent text-[var(--brand-ink)]' : 'bg-[var(--surface)]'
                }`}
                style={days === d ? { background: 'var(--brand)' } : undefined}
              >
                {d} days
              </Link>
            ))}
          </div>
        }
      />

      <div className="space-y-6">
        <StatGrid>
          <Stat
            label="Attendance"
            value={expectedTotal > 0 ? `${Math.round((presentTotal / expectedTotal) * 100)}%` : '—'}
            sub={`${presentTotal} of ${expectedTotal} expected`}
          />
          <Stat label="Classes held" value={String(sessions.length)} sub={`last ${days} days`} />
          <Stat label="Learners tracked" value={String(learners.length)} />
          <Stat label="Below 60%" value={String(atRisk.length)} sub="worth a call" />
        </StatGrid>

        {learners.length === 0 ? (
          <EmptyState
            title="No classes in this period"
            hint="Attendance is recorded when a learner joins from their dashboard."
          />
        ) : (
          <>
            <section>
              <h2 className="t-heading mb-3">Learners, worst first</h2>
              <Table head={['Learner', 'Contact', 'Attended', 'Rate', '']}>
                {learners.slice(0, 40).map((l) => (
                  <Row key={l.id}>
                    <Cell className="font-medium">{l.name}</Cell>
                    <Cell className="t-small faint">{l.phone ?? l.email ?? '—'}</Cell>
                    <Cell className="tabular-nums">
                      {l.came} of {l.expected}
                    </Cell>
                    <Cell>
                      <div className="w-28">
                        <div className="flex items-baseline justify-between">
                          <span className="t-small tabular-nums">{l.percent}%</span>
                        </div>
                        <div className="mt-1">
                          <Meter
                            value={l.percent ?? 0}
                            max={100}
                            tone={
                              (l.percent ?? 0) >= 75 ? 'ok' : (l.percent ?? 0) >= 60 ? 'warn' : 'bad'
                            }
                          />
                        </div>
                      </div>
                    </Cell>
                    <Cell>
                      {(l.percent ?? 100) < 60 && <Badge tone="bad">at risk</Badge>}
                    </Cell>
                  </Row>
                ))}
              </Table>
            </section>

            <section>
              <h2 className="t-heading mb-3">Recent classes</h2>
              <Card padded={false}>
                <ul className="divide-y">
                  {sessions.slice(0, 20).map((s) => {
                    const size = rosterSize(s);
                    const came = s.attendances.filter(
                      (a) => a.status === 'PRESENT' || a.status === 'LATE',
                    ).length;
                    const pct = size > 0 ? Math.round((came / size) * 100) : 0;

                    return (
                      <li key={s.id}>
                        <Link
                          href={`/admin/sessions/${s.id}`}
                          className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-[var(--surface-2)]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{s.title}</span>
                            <span className="t-small faint block">
                              {s.batch?.name ?? `One to one${s.learner ? ` · ${s.learner.name}` : ''}`} ·{' '}
                              {s.startsAt.toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                              })}
                            </span>
                          </span>
                          <span className="t-small shrink-0 tabular-nums">
                            <span className={came === 0 ? 'text-[var(--bad)]' : ''}>
                              {came} of {size}
                            </span>
                            <span className="faint"> · {pct}%</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
