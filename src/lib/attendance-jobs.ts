import { db } from '@/lib/db';
import { onlineAbsentAfterMinutes, recordAttendance } from '@/lib/attendance';
import { onlineNoShows } from '@/lib/attendance-rules';

/**
 * Online no-shows, decided on the clock.
 *
 * For a class in an online or hybrid batch that the platform has confirmed
 * started (its status went LIVE on a meeting.started event, or COMPLETED
 * after it), a learner with no record at all by the check time is marked
 * absent by the system and their parents are told, which is the "immediate
 * alert" the requirements ask for and the platform cannot give on its own.
 *
 * A class the platform never reported is left alone: the register shows
 * "awaiting attendance data" and a teacher can mark it by hand. Missing
 * data is never an absence.
 */
export async function markOnlineNoShows(organizationId: string, now = new Date()): Promise<{ checked: number; marked: number }> {
  const windowStart = new Date(now.getTime() - 6 * 3_600_000);
  const sessions = await db.liveSession.findMany({
    where: {
      organizationId,
      status: { in: ['LIVE', 'COMPLETED'] },
      isHoliday: false,
      startsAt: { gte: windowStart, lte: now },
      batch: { mode: { in: ['ONLINE', 'HYBRID'] } },
    },
    select: {
      id: true,
      startsAt: true,
      batchId: true,
      batch: { select: { enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED'] } }, select: { userId: true } } } },
      attendances: { select: { userId: true } },
    },
    take: 50,
  });

  let marked = 0;
  for (const s of sessions) {
    const recorded = new Set(s.attendances.map((a) => a.userId));
    const unrecorded = (s.batch?.enrollments ?? []).map((e) => e.userId).filter((id) => !recorded.has(id));
    if (unrecorded.length === 0) continue;
    const absentAfter = await onlineAbsentAfterMinutes(organizationId, s.batchId);
    const noShows = onlineNoShows({ confirmedStarted: true, startsAt: s.startsAt, now, absentAfterMinutes: absentAfter, unrecorded });
    for (const userId of noShows) {
      await recordAttendance({
        organizationId,
        sessionId: s.id,
        userId,
        status: 'ABSENT',
        source: 'PROVIDER',
        note: `Had not joined ${absentAfter} minutes after the start`,
      });
      marked += 1;
    }
  }
  return { checked: sessions.length, marked };
}
