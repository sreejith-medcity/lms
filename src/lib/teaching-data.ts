import { db } from '@/lib/db';
import { activeStaffWhere } from '@/lib/scope-rules';
import { computePayout, sessionMinutes, type PayoutLine } from '@/lib/payouts';

/**
 * Who took which class.
 *
 * A class names its instructors on the session where the office set them;
 * where it did not, the batch's primary tutor took it. Both readings are
 * used here, so a payout and a trainer's desk agree with the calendar.
 */

interface TakenSession {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  batchId: string | null;
  learnerId: string | null;
  batch: { name: string } | null;
  instructors: { userId: string }[];
}

/** Session id → instructor user ids, falling back to the batch's primary tutor. */
async function instructorsOf(organizationId: string, sessions: TakenSession[]): Promise<Map<string, string[]>> {
  const unnamed = sessions.filter((s) => s.instructors.length === 0 && s.batchId);
  const batchIds = Array.from(new Set(unnamed.map((s) => s.batchId as string)));
  const tutors = batchIds.length
    ? await db.batchStaff.findMany({ where: { batchId: { in: batchIds }, role: 'PRIMARY_TUTOR', batch: { organizationId } }, select: { batchId: true, userId: true } })
    : [];
  const byBatch = new Map<string, string[]>();
  for (const t of tutors) byBatch.set(t.batchId, [...(byBatch.get(t.batchId) ?? []), t.userId]);
  const out = new Map<string, string[]>();
  for (const s of sessions) {
    out.set(s.id, s.instructors.length ? s.instructors.map((i) => i.userId) : (s.batchId ? byBatch.get(s.batchId) ?? [] : []));
  }
  return out;
}

const takenSelect = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  batchId: true,
  learnerId: true,
  batch: { select: { name: true } },
  instructors: { select: { userId: true } },
} as const;

/** Every completed class in the window, grouped per instructor as payout lines. */
export async function classesTaken(organizationId: string, from: Date, to: Date): Promise<Map<string, PayoutLine[]>> {
  const sessions = await db.liveSession.findMany({
    where: { organizationId, status: 'COMPLETED', isHoliday: false, startsAt: { gte: from, lt: to } },
    orderBy: { startsAt: 'asc' },
    select: takenSelect,
  });
  const who = await instructorsOf(organizationId, sessions);
  const out = new Map<string, PayoutLine[]>();
  for (const s of sessions) {
    for (const userId of who.get(s.id) ?? []) {
      const line: PayoutLine = { sessionId: s.id, title: s.title, startsAt: s.startsAt.toISOString(), minutes: sessionMinutes(s.startsAt, s.endsAt), batch: s.batch?.name ?? null, oneToOne: Boolean(s.learnerId) };
      out.set(userId, [...(out.get(userId) ?? []), line]);
    }
  }
  return out;
}

/** Draft figures for every instructor who took a class in the window. */
export async function draftPayouts(organizationId: string, from: Date, to: Date) {
  const taken = await classesTaken(organizationId, from, to);
  const userIds = Array.from(taken.keys());
  if (userIds.length === 0) return [];
  const people = await db.user.findMany({
    where: { organizationId, id: { in: userIds } },
    select: { id: true, name: true, instructorProfile: { select: { hourlyRatePaise: true, perSessionPaise: true } } },
  });
  return people.map((p) => {
    const lines = taken.get(p.id) ?? [];
    const rate = { hourlyRatePaise: p.instructorProfile?.hourlyRatePaise ?? null, perSessionPaise: p.instructorProfile?.perSessionPaise ?? null };
    return { userId: p.id, name: p.name, lines, maths: computePayout(lines, rate), hasRate: Boolean(rate.hourlyRatePaise || rate.perSessionPaise) };
  });
}

/* The trainer's desk ------------------------------------------------------- */

export async function myDesk(organizationId: string, userId: string, now: Date, monthFrom: Date, monthTo: Date) {
  const weekAhead = new Date(now.getTime() + 7 * 864e5);
  const [staffRows, profile] = await Promise.all([
    db.batchStaff.findMany({
      // Only what is assigned today: an ended assignment leaves the desk the
      // day after its end date, an upcoming one arrives on its start date.
      where: { userId, batch: { organizationId, deletedAt: null }, ...activeStaffWhere(now) },
      select: { role: true, batch: { select: { id: true, name: true, status: true, startDate: true, endDate: true, course: { select: { id: true, product: { select: { id: true, title: true } } } }, _count: { select: { enrollments: true } } } } },
    }),
    db.instructorProfile.findUnique({ where: { userId }, select: { hourlyRatePaise: true, perSessionPaise: true, isMentor: true } }),
  ]);
  const batchIds = staffRows.map((r) => r.batch.id);
  const courseIds = Array.from(new Set(staffRows.map((r) => r.batch.course.id)));

  const [upcomingRaw, monthRaw, feedback, toMark, homeworkToMark, questionsWaiting, payouts] = await Promise.all([
    db.liveSession.findMany({
      where: { organizationId, status: { in: ['SCHEDULED', 'LIVE'] }, startsAt: { gte: new Date(now.getTime() - 3_600_000), lte: weekAhead }, OR: [{ instructors: { some: { userId } } }, { batchId: { in: batchIds } }] },
      orderBy: { startsAt: 'asc' },
      take: 20,
      select: { ...takenSelect, hostUrl: true, joinUrl: true, status: true },
    }),
    db.liveSession.findMany({
      where: { organizationId, status: 'COMPLETED', isHoliday: false, startsAt: { gte: monthFrom, lt: monthTo }, OR: [{ instructors: { some: { userId } } }, { batchId: { in: batchIds } }] },
      select: takenSelect,
    }),
    db.feedbackResponse.aggregate({ where: { trainerId: userId, form: { organizationId }, rating: { not: null } }, _avg: { rating: true }, _count: true }),
    db.submission.count({ where: { status: 'NOT_EVALUATED', attempt: { assessment: { organizationId }, enrollment: { batchId: { in: batchIds } } } } }),
    db.assignmentSubmission.count({ where: { organizationId, status: 'SUBMITTED', assignment: { OR: [{ batchId: { in: batchIds } }, { createdById: userId }] } } }),
    db.lessonQuestion.count({ where: { organizationId, answeredAt: null, isHidden: false, OR: [{ batchId: { in: batchIds } }, { batchId: null, courseId: { in: courseIds } }] } }),
    db.instructorPayout.findMany({ where: { organizationId, userId }, orderBy: { periodFrom: 'desc' }, take: 6, select: { id: true, periodFrom: true, periodTo: true, sessions: true, minutes: true, totalPaise: true, status: true, paidAt: true } }),
  ]);

  // Only the classes this person actually takes: named on the session, or
  // unnamed on a batch where they are the primary tutor.
  const mine = (rows: TakenSession[]) => {
    const primaryOf = new Set(staffRows.filter((r) => r.role === 'PRIMARY_TUTOR').map((r) => r.batch.id));
    return rows.filter((s) => (s.instructors.length ? s.instructors.some((i) => i.userId === userId) : s.batchId ? primaryOf.has(s.batchId) : false));
  };
  const upcoming = mine(upcomingRaw) as typeof upcomingRaw;
  const month = mine(monthRaw);
  const monthMinutes = month.reduce((n, s) => n + sessionMinutes(s.startsAt, s.endsAt), 0);

  return {
    batches: staffRows.map((r) => ({ ...r.batch, role: r.role })),
    courseIds,
    upcoming,
    monthClasses: month.length,
    monthMinutes,
    oneToOne: upcoming.filter((s) => s.learnerId).length,
    rating: feedback._avg.rating ? { average: Math.round(feedback._avg.rating * 10) / 10, count: feedback._count } : null,
    toMark,
    homeworkToMark,
    questionsWaiting,
    payouts,
    profile,
  };
}
