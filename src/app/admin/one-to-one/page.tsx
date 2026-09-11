import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { WEEKDAY_LABELS, dayKey, formatDayLabel, formatTime } from '@/lib/clock';
import { creditsLeft } from '@/lib/booking-slots';
import { AvailabilityEditor, CreditGrant, BookForLearner, CancelClass } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * One-to-one classes, which are classes with no batch.
 *
 * Three things on one screen, because they are one job: when each trainer
 * can be booked, who has sessions left, and what is in the diary. The
 * academy used to do this by making a batch of one per learner, which
 * worked and quietly wrecked every batch report.
 */
export default async function OneToOnePage() {
  const tenant = await requireTenant();
  const me = await requireStaff('scheduling.sessions', 'view');
  const canEdit = me.permissions['scheduling.sessions']?.edit ?? false;
  const tz = tenant.timezone;

  const [trainers, learners, availability, blackouts, credits, upcoming] = await Promise.all([
    db.user.findMany({
      where: {
        organizationId: tenant.organizationId,
        deletedAt: null,
        OR: [{ kind: 'STAFF' }, { instructorProfile: { isNot: null } }],
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { organizationId: tenant.organizationId, kind: 'LEARNER', deletedAt: null },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, email: true },
    }),
    db.mentorAvailability.findMany({
      where: { organizationId: tenant.organizationId, isActive: true },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      select: {
        id: true,
        userId: true,
        weekday: true,
        startMinute: true,
        endMinute: true,
        slotMinutes: true,
      },
    }),
    db.mentorBlackout.findMany({
      where: { organizationId: tenant.organizationId, endsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, userId: true, startsAt: true, endsAt: true, reason: true },
    }),
    db.oneToOneCredit.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        sessionsTotal: true,
        minutesPerSession: true,
        expiresAt: true,
        note: true,
        user: { select: { id: true, name: true } },
        _count: { select: { sessions: { where: { cancelledAt: null } } } },
      },
    }),
    db.liveSession.findMany({
      where: {
        organizationId: tenant.organizationId,
        learnerId: { not: null },
        startsAt: { gte: new Date(Date.now() - 86_400_000) },
      },
      orderBy: { startsAt: 'asc' },
      take: 80,
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        status: true,
        cancelledAt: true,
        joinUrl: true,
        learner: { select: { id: true, name: true } },
        instructors: { select: { userId: true } },
      },
    }),
  ]);

  const trainerName = new Map(trainers.map((t) => [t.id, t.name]));

  const withLeft = credits.map((c) => ({
    ...c,
    ...creditsLeft({
      sessionsTotal: c.sessionsTotal,
      bookedCount: c._count.sessions,
      expiresAt: c.expiresAt,
    }),
  }));

  const sessionsLeft = withLeft.filter((c) => !c.expired).reduce((n, c) => n + c.left, 0);
  const booked = upcoming.filter((s) => !s.cancelledAt).length;

  return (
    <div>
      <PageHeader
        title="One to one"
        description="Classes that belong to a learner rather than to a batch. Set when each trainer can be booked, give a learner sessions, and the diary fills itself."
        action={
          <Link href="/admin/sessions" className="t-small underline">
            Batch classes
          </Link>
        }
      />

      <div className="space-y-6">
        <StatGrid>
          <Stat label="Sessions unbooked" value={sessionsLeft} sub="bought or given, not yet used" />
          <Stat label="In the diary" value={booked} sub="from yesterday onwards" />
          <Stat label="Trainers bookable" value={new Set(availability.map((a) => a.userId)).size} />
          <Stat label="Away periods" value={blackouts.length} sub="upcoming" />
        </StatGrid>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4">
            <div>
              <h2 className="t-heading">When trainers can be booked</h2>
              <p className="t-small muted mt-1">
                A weekly pattern in the academy&rsquo;s own time. Everything else is subtraction:
                days they are away, classes already in the diary, and anything too soon to arrange.
              </p>
            </div>

            {canEdit && <AvailabilityEditor trainers={trainers} />}

            {availability.length === 0 ? (
              <EmptyState title="Nobody is bookable yet" hint="Add a window above." />
            ) : (
              <ul className="divide-y">
                {availability.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="t-small">
                      <span className="font-medium">{trainerName.get(a.userId) ?? 'Trainer'}</span>
                      <span className="faint">
                        {' '}
                        · {WEEKDAY_LABELS[a.weekday]} {clock(a.startMinute)} to {clock(a.endMinute)}
                        {' · '}
                        {a.slotMinutes} min slots
                      </span>
                    </span>
                    {canEdit && <CancelClass kind="availability" id={a.id} label="remove" />}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-4">
            <div>
              <h2 className="t-heading">Sessions a learner holds</h2>
              <p className="t-small muted mt-1">
                Bought with a one-to-one product, or given here. What is left is counted from the
                classes booked against it, so calling one off returns it.
              </p>
            </div>

            {canEdit && <CreditGrant learners={learners} />}

            {withLeft.length === 0 ? (
              <EmptyState title="Nobody has any yet" hint="Give some above, or sell a one-to-one product." />
            ) : (
              <ul className="divide-y">
                {withLeft.slice(0, 12).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="t-small">
                      <Link href={`/admin/learners/${c.user.id}`} className="font-medium hover:underline">
                        {c.user.name}
                      </Link>
                      <span className="faint">
                        {' '}
                        · {c.left} of {c.sessionsTotal} left · {c.minutesPerSession} min
                        {c.expired ? ' · expired' : ''}
                      </span>
                    </span>
                    {c.left > 0 && !c.expired && canEdit && (
                      <BookForLearner
                        learnerId={c.user.id}
                        learnerName={c.user.name}
                        creditId={c.id}
                        minutes={c.minutesPerSession}
                        trainers={trainers}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <section>
          <h2 className="t-heading mb-3">The diary</h2>
          {upcoming.length === 0 ? (
            <EmptyState
              title="No one-to-one classes yet"
              hint="Once a learner holds sessions, either they book or you book for them."
            />
          ) : (
            <Table head={['When', 'Learner', 'Trainer', 'Class', 'Status', '']}>
              {upcoming.map((s) => (
                <Row key={s.id}>
                  <Cell>
                    <span className="text-sm">
                      {formatDayLabel(dayKey(s.startsAt, tz), tz)}, {formatTime(s.startsAt, tz)}
                    </span>
                  </Cell>
                  <Cell>
                    {s.learner ? (
                      <Link href={`/admin/learners/${s.learner.id}`} className="text-sm hover:underline">
                        {s.learner.name}
                      </Link>
                    ) : (
                      <span className="t-small faint">—</span>
                    )}
                  </Cell>
                  <Cell className="t-small muted">
                    {trainerName.get(s.instructors[0]?.userId ?? '') ?? 'Unassigned'}
                  </Cell>
                  <Cell className="t-small">
                    <Link href={`/admin/sessions/${s.id}`} className="hover:underline">
                      {s.title}
                    </Link>
                  </Cell>
                  <Cell>
                    {s.cancelledAt ? (
                      <Badge tone="bad">called off</Badge>
                    ) : s.joinUrl ? (
                      <Badge tone="ok">ready</Badge>
                    ) : (
                      <Badge tone="warn">no link yet</Badge>
                    )}
                  </Cell>
                  <Cell className="text-right">
                    {!s.cancelledAt && canEdit && <CancelClass kind="session" id={s.id} label="call off" />}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </section>
      </div>
    </div>
  );
}
