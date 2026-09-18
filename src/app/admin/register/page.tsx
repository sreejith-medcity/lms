import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { scopeNote, sessionWhere, staffScope } from '@/lib/scope';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The registers a teacher owes, on a phone.
 *
 * Classes from the last week that have started, theirs by assignment,
 * worst first: no register yet, then partly recorded, then confirmed. A
 * cancelled class or a holiday has no register and is not listed.
 */
export default async function RegisterList() {
  const tenant = await requireTenant();
  const me = await requireStaff('scheduling.sessions', 'view');
  const scope = await staffScope(me);
  const tz = tenant.timezone;
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 864e5);

  const sessions = await db.liveSession.findMany({
    where: {
      organizationId: tenant.organizationId,
      startsAt: { gte: since, lte: now },
      status: { not: 'CANCELLED' },
      isHoliday: false,
      batchId: { not: null },
      ...sessionWhere(scope),
    },
    orderBy: { startsAt: 'desc' },
    take: 60,
    select: {
      id: true,
      title: true,
      startsAt: true,
      status: true,
      registerSubmittedAt: true,
      batch: { select: { name: true, mode: true, _count: { select: { enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED'] } } } } } } },
      _count: { select: { attendances: true } },
    },
  });

  const rows = sessions.map((s) => {
    const roll = s.batch?._count.enrollments ?? 0;
    const recorded = s._count.attendances;
    const state = s.registerSubmittedAt ? 'confirmed' : recorded === 0 ? 'no register' : recorded < roll ? 'partly recorded' : 'not confirmed';
    return { ...s, roll, recorded, state };
  });
  const order = { 'no register': 0, 'partly recorded': 1, 'not confirmed': 2, confirmed: 3 } as const;
  rows.sort((a, b) => order[a.state as keyof typeof order] - order[b.state as keyof typeof order] || b.startsAt.getTime() - a.startsAt.getTime());
  const note = scopeNote(scope);

  return (
    <div>
      <PageHeader
        title="Register"
        description={`Classes from the last seven days. Open one, mark Present, Absent or Late, check the counts, confirm. Parents of anyone absent or late are told the moment you confirm.${note ? ` ${note}` : ''}`}
      />
      {rows.length === 0 ? (
        <EmptyState title="No classes to record" hint={scope.kind === 'batches' && scope.batchIds.length === 0 ? 'No batch is assigned to you. Your Branch Head assigns batches from the batch page.' : 'Nothing in your batches has started in the last week.'} />
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {rows.map((s) => (
              <li key={s.id}>
                <Link href={`/admin/register/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--surface-2)]">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.title}</p>
                    <p className="t-small faint truncate">
                      {s.batch?.name} · {formatDayLabel(dayKey(s.startsAt, tz), tz)} {formatTime(s.startsAt, tz)}
                      {s.batch?.mode === 'ONLINE' ? ' · online' : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge tone={s.state === 'confirmed' ? 'ok' : s.state === 'no register' ? 'bad' : 'warn'}>{s.state}</Badge>
                    <p className="t-micro faint mt-1 tabular-nums">
                      {s.recorded} of {s.roll}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
