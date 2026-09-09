import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { Badge, Card, EmptyState, PageHeader, Section } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { ScheduleForm } from './schedule-form';

export const dynamic = 'force-dynamic';

export default async function SessionsPage() {
  const tenant = await requireTenant();
  const orgId = tenant.organizationId;

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const weekEnd = new Date(dayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const [today, upcoming, batches, todayStats] = await Promise.all([
    db.liveSession.findMany({
      where: { organizationId: orgId, startsAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { startsAt: 'asc' },
      include: {
        batch: { select: { name: true, _count: { select: { enrollments: true } } } },
        _count: { select: { attendances: true } },
      },
    }),
    db.liveSession.findMany({
      where: { organizationId: orgId, startsAt: { gte: dayEnd, lt: weekEnd }, status: { not: 'CANCELLED' } },
      orderBy: { startsAt: 'asc' },
      take: 40,
      include: { batch: { select: { name: true } } },
    }),
    db.batch.findMany({
      where: { organizationId: orgId, deletedAt: null, status: { in: ['ACTIVE', 'UPCOMING'] } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, course: { select: { product: { select: { title: true } } } } },
    }),
    db.liveSession.groupBy({
      by: ['status'],
      where: { organizationId: orgId, startsAt: { gte: dayStart, lt: dayEnd } },
      _count: true,
    }),
  ]);

  const scheduled = todayStats.find((s) => s.status === 'SCHEDULED')?._count ?? 0;
  const cancelled = todayStats.find((s) => s.status === 'CANCELLED')?._count ?? 0;
  const signIns = today.reduce((n, s) => n + s._count.attendances, 0);
  const expected = today.reduce((n, s) => n + s.batch._count.enrollments, 0);

  return (
    <div className="space-y-7">
      <PageHeader
        title="Classes"
        description="What is running today, what is coming, and who turned up."
      />

      <StatGrid>
        <Stat label="Today" value={today.length} sub={`${scheduled} scheduled`} />
        <Stat label="Cancelled" value={cancelled} sub="today" />
        <Stat label="Sign-ins" value={signIns} sub={expected > 0 ? `of ${expected} enrolled` : undefined} />
        <Stat
          label="Attendance"
          value={expected > 0 ? `${Math.round((signIns / expected) * 100)}%` : '—'}
          sub="today"
        />
      </StatGrid>

      <Section title="Today">
        {today.length === 0 ? (
          <EmptyState title="No classes today" hint="Schedule one below, or enjoy the quiet." />
        ) : (
          <Card padded={false}>
            <ul className="divide-y">
              {today.map((s) => {
                const live = s.startsAt <= now && s.endsAt >= now && s.status !== 'CANCELLED';
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                    <span className="w-20 shrink-0 tabular-nums">
                      {s.startsAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/sessions/${s.id}`} className="t-body font-medium hover:underline">
                        {s.title}
                      </Link>
                      <p className="t-small faint truncate">{s.batch.name}</p>
                    </div>
                    {live && <Badge tone="ok">live now</Badge>}
                    {s.status === 'CANCELLED' && <Badge tone="bad">cancelled</Badge>}
                    <span className="t-small faint w-28 shrink-0 text-right tabular-nums">
                      {s._count.attendances} / {s.batch._count.enrollments} in
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Section title="Next seven days">
          {upcoming.length === 0 ? (
            <EmptyState title="Nothing scheduled" hint="The week ahead is empty." />
          ) : (
            <Card padded={false}>
              <ul className="divide-y">
                {upcoming.map((s) => (
                  <li key={s.id} className="flex items-center gap-4 px-5 py-2.5">
                    <span className="t-small faint w-28 shrink-0 tabular-nums">
                      {s.startsAt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </span>
                    <span className="w-16 shrink-0 tabular-nums">
                      {s.startsAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="t-small min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="t-small faint hidden shrink-0 truncate sm:block">{s.batch.name}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Section>

        <Section title="Schedule classes">
          <Card>
            <ScheduleForm batches={batches.map((b) => ({ id: b.id, name: b.name, course: b.course.product.title }))} />
          </Card>
        </Section>
      </div>
    </div>
  );
}
