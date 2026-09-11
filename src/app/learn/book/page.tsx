import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { Card, EmptyState } from '@/components/ui';
import { creditsLeft } from '@/lib/booking-slots';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';
import { BookSlot, CancelMine } from './booking';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Book a one to one', robots: { index: false, follow: false } };

/**
 * The learner's side of a one-to-one: what they hold, what is booked, and a
 * list of times they can actually have.
 *
 * The times are worked out from the trainer's week rather than typed in as a
 * request, so a booking is a booking rather than the start of a conversation
 * about whether that time works.
 */
export default async function BookOneToOne() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const [credits, booked, trainers] = await Promise.all([
    db.oneToOneCredit.findMany({
      where: { organizationId: tenant.organizationId, userId: user.id },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        sessionsTotal: true,
        minutesPerSession: true,
        expiresAt: true,
        _count: { select: { sessions: { where: { cancelledAt: null } } } },
      },
    }),
    db.liveSession.findMany({
      where: {
        organizationId: tenant.organizationId,
        learnerId: user.id,
        cancelledAt: null,
        startsAt: { gte: new Date(Date.now() - 3_600_000) },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        title: true,
        startsAt: true,
        joinUrl: true,
        instructors: { select: { userId: true } },
      },
    }),
    db.user.findMany({
      where: {
        organizationId: tenant.organizationId,
        deletedAt: null,
        instructorProfile: { isNot: null },
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        instructorProfile: { select: { headline: true } },
      },
    }),
  ]);

  const usable = credits
    .map((c) => ({
      ...c,
      ...creditsLeft({
        sessionsTotal: c.sessionsTotal,
        bookedCount: c._count.sessions,
        expiresAt: c.expiresAt,
      }),
    }))
    .filter((c) => c.left > 0 && !c.expired);

  const totalLeft = usable.reduce((n, c) => n + c.left, 0);
  const minutes = usable[0]?.minutesPerSession ?? 30;

  const bookableTrainers = await db.mentorAvailability.findMany({
    where: { organizationId: tenant.organizationId, isActive: true },
    distinct: ['userId'],
    select: { userId: true },
  });
  const bookableIds = new Set(bookableTrainers.map((t) => t.userId));
  const offered = trainers.filter((t) => bookableIds.has(t.id));

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <h1 className="t-title">One to one classes</h1>
      <p className="t-small muted mt-1">
        {totalLeft > 0
          ? `You have ${totalLeft} session${totalLeft === 1 ? '' : 's'} to book, ${minutes} minutes each.`
          : 'You have no one-to-one sessions at the moment.'}
      </p>

      {booked.length > 0 && (
        <Card className="mt-6 space-y-3">
          <h2 className="t-heading">Booked</h2>
          <ul className="divide-y">
            {booked.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="t-small">
                  <span className="font-medium">
                    {formatDayLabel(dayKey(s.startsAt, tenant.timezone), tenant.timezone)},{' '}
                    {formatTime(s.startsAt, tenant.timezone)}
                  </span>
                  <span className="faint"> · {s.title}</span>
                </span>
                <span className="flex items-center gap-3">
                  {s.joinUrl && (
                    <a
                      href={s.joinUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="t-small underline"
                      style={{ color: 'var(--brand)' }}
                    >
                      Join
                    </a>
                  )}
                  <CancelMine sessionId={s.id} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-6">
        {totalLeft === 0 ? (
          <EmptyState
            title="Nothing to book yet"
            hint="One-to-one sessions come with certain courses, or the academy can add them to your account."
          />
        ) : offered.length === 0 ? (
          <EmptyState
            title="No trainer has hours set"
            hint="Contact the academy and they will arrange a time."
          />
        ) : (
          <Card className="space-y-4">
            <h2 className="t-heading">Book a time</h2>
            <BookSlot
              minutes={minutes}
              creditId={usable[0]?.id ?? ''}
              trainers={offered.map((t) => ({
                id: t.id,
                name: t.name,
                headline: t.instructorProfile?.headline ?? null,
              }))}
            />
            <p className="t-small faint">
              Times are shown in the academy&rsquo;s timezone. A class can be called off here up to
              twelve hours beforehand, and the session goes back to your balance.
            </p>
          </Card>
        )}
      </div>

      <Link href="/learn" className="t-small mt-8 inline-block underline">
        Back to my learning
      </Link>
    </div>
  );
}
