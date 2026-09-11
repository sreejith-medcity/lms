import { db } from '@/lib/db';
import { queueNotifications } from '@/lib/notify';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';

/**
 * Class reminders, queued by the clock rather than by somebody remembering.
 *
 * The manual button stays, because a trainer moving a class at short notice
 * wants to tell the room now. This is the other case: the ordinary Tuesday
 * evening class that nobody thinks about until half the batch has missed it.
 *
 * Queued an hour ahead, deduplicated per class, so running this every few
 * minutes queues each reminder exactly once however often it runs.
 */

const LEAD_MINUTES = 60;

export interface ReminderResult {
  classes: number;
  queued: number;
}

export async function queueUpcomingReminders(organizationId: string): Promise<ReminderResult> {
  const now = new Date();
  const until = new Date(now.getTime() + LEAD_MINUTES * 60_000);

  const upcoming = await db.liveSession.findMany({
    where: {
      organizationId,
      status: 'SCHEDULED',
      cancelledAt: null,
      isHoliday: false,
      startsAt: { gt: now, lte: until },
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      joinUrl: true,
      learner: { select: { id: true, name: true, email: true, phone: true } },
      batch: {
        select: {
          enrollments: {
            where: { status: { in: ['ENROLLED', 'REGISTERED'] } },
            select: { user: { select: { id: true, name: true, email: true, phone: true } } },
          },
        },
      },
    },
  });

  if (!upcoming.length) return { classes: 0, queued: 0 };

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true, name: true },
  });
  const zone = organization?.timezone ?? 'Asia/Calcutta';

  let queued = 0;

  for (const session of upcoming) {
    // A one-to-one class has no roster, so the person to remind is the
    // learner it was booked for.
    const people = session.batch
      ? session.batch.enrollments.map((row) => row.user)
      : session.learner
        ? [session.learner]
        : [];
    if (!people.length) continue;

    const result = await queueNotifications({
      organizationId,
      eventKey: 'session.reminder',
      recipients: people.map((person) => ({
        userId: person.id,
        email: person.email,
        phone: person.phone,
      })),
      // The class id, so a second run finds these already queued and adds none.
      dedupeKey: `session.reminder:${session.id}`,
      context: {
        title: session.title,
        date: formatDayLabel(dayKey(session.startsAt, zone), zone, true),
        time: formatTime(session.startsAt, zone),
        joinUrl: session.joinUrl ?? '',
        organization: organization?.name ?? '',
      },
      contextFor: (person) => ({
        name: people.find((p) => p.id === person.userId)?.name ?? 'there',
      }),
    });

    queued += result.queued;
  }

  return { classes: upcoming.length, queued };
}
