import { db } from '@/lib/db';
import { dayKey, todayKey } from '@/lib/clock';
import {
  LEARNER_LEAVE_MAX_DAYS,
  freeEnrolments,
  learnerFeedbackProblem,
  learnerLeaveProblem,
  milestoneLabel,
  minuteOf,
  openStartTimes,
  scoreOf,
  slotLabel,
  timeField,
  timeLabel,
  weekdaysLabel,
} from './rules';
import { TutoringError, applyLearnerLeave, placeSeat, tutorStates } from './data';

/**
 * A learner's side of online tutoring, once, for the web page and the phone.
 *
 * What they see (the class times they may choose, their tutor and how far
 * along they are, the feedback asked of them, the tutor's notes, their
 * leave) and the three things they do (choose a time, take leave, give
 * feedback). The page's server actions and the app's API both call these,
 * so the two cannot drift apart on a rule.
 */

export interface Academy {
  organizationId: string;
  timezone: string;
}

export type Outcome = { ok: true; message: string } | { ok: false; error: string };

export interface TutoringChoice {
  offerId: string;
  title: string;
  format: 'ONE_TO_ONE' | 'GROUP';
  groupSize: number;
  classesTotal: number;
  classMinutes: number;
  weekdays: number[];
  days: string;
  times: { value: string; label: string }[];
}

export interface TutoringSeatView {
  id: string;
  offerId: string;
  title: string;
  status: 'WAITING' | 'PLACED' | 'COMPLETED';
  /** What they asked for, while no tutor is free then. */
  askedTime: string;
  askedFrom: string;
  group: {
    tutor: string;
    days: string;
    time: string;
    oneToOne: boolean;
    classesDone: number;
    classesTotal: number;
    /** The last class day, YYYY-MM-DD on the academy's calendar. */
    finishesOn: string | null;
    nextClassAt: Date | null;
  } | null;
}

export interface LearnerTutoringView {
  /** Today on the academy's calendar: the earliest day a course or a leave can start. */
  today: string;
  leaveMaxDays: number;
  /** Whether the screen is worth a place in the menu: a seat, or a course to choose a time for. */
  applies: boolean;
  /** How many things are waiting on the learner: times to choose and feedback to give. */
  attention: number;
  choices: TutoringChoice[];
  feedbackDue: { id: string; title: string; milestone: number; when: string }[];
  seats: TutoringSeatView[];
  notes: { id: string; tutor: string; milestone: number; when: string; rating: number | null; comment: string; submittedAt: Date | null }[];
  leave: { id: string; fromDay: string; toDay: string; classesMoved: number }[];
}

export async function learnerTutoringView(academy: Academy, userId: string, now = new Date()): Promise<LearnerTutoringView> {
  const { organizationId, timezone } = academy;
  const today = todayKey(timezone);

  const [seats, offers, enrolments, due, notes, leaves] = await Promise.all([
    db.tutoringSeat.findMany({ where: { organizationId, userId, status: { in: ['WAITING', 'PLACED', 'COMPLETED'] } }, orderBy: { createdAt: 'desc' }, include: { group: true } }),
    db.tutoringOffer.findMany({ where: { organizationId, active: true } }),
    db.enrollment.findMany({ where: { organizationId, userId, status: { in: ['ENROLLED', 'REGISTERED'] } }, select: { id: true, product: { select: { title: true, course: { select: { id: true } } } } } }),
    db.tutoringFeedback.findMany({ where: { organizationId, learnerId: userId, direction: 'LEARNER', submittedAt: null }, orderBy: { dueAt: 'asc' } }),
    db.tutoringFeedback.findMany({ where: { organizationId, learnerId: userId, direction: 'TUTOR', submittedAt: { not: null } }, orderBy: { submittedAt: 'desc' }, take: 12 }),
    db.learnerLeave.findMany({ where: { organizationId, userId, status: 'APPROVED' }, orderBy: { fromDay: 'desc' }, take: 10 }),
  ]);

  /* One enrolment, one run of classes: a course is offered a time only on an enrolment that has not had its run. */
  const mine = new Map(freeEnrolments(enrolments, seats).filter((e) => e.product.course).map((e) => [e.product.course!.id, e.product.title]));
  const taken = new Set(seats.filter((s) => s.status !== 'COMPLETED').map((s) => s.offerId));
  const toChoose = offers.filter((o) => mine.has(o.courseId) && !taken.has(o.id));
  const choices: TutoringChoice[] = await Promise.all(
    toChoose.map(async (o) => {
      const tutors = await tutorStates(organizationId, o.id, today);
      const capacity = o.format === 'GROUP' ? Math.max(2, o.groupSize) : 1;
      const times = new Set(openStartTimes(tutors, { weekdays: o.weekdays, minutes: o.classMinutes }));
      /* A group that has not begun and has a seat is a time too, whether or not another tutor is free then. */
      if (capacity > 1) {
        const open = await db.tutoringGroup.findMany({
          where: { organizationId, offerId: o.id, status: 'ACTIVE', needsTutor: false, startsOn: { gt: today } },
          select: { startMinute: true, capacity: true, _count: { select: { seats: { where: { status: 'PLACED' } } } } },
        });
        for (const g of open) if (g._count.seats < g.capacity) times.add(g.startMinute);
      }
      return {
        offerId: o.id,
        title: mine.get(o.courseId) ?? 'Course',
        format: o.format === 'GROUP' ? ('GROUP' as const) : ('ONE_TO_ONE' as const),
        groupSize: o.groupSize,
        classesTotal: o.classesTotal,
        classMinutes: o.classMinutes,
        weekdays: o.weekdays,
        days: weekdaysLabel(o.weekdays),
        times: [...times].sort((a, b) => a - b).map((m) => ({ value: timeField(m), label: timeLabel(m) })),
      };
    }),
  );

  /* A seat can outlive its offer being switched off, so titles are read for every offer a seat names. */
  const offerIds = [...new Set(seats.map((s) => s.offerId))];
  const seatOffers = offerIds.length ? await db.tutoringOffer.findMany({ where: { organizationId, id: { in: offerIds } }, select: { id: true, courseId: true } }) : [];
  const groups = seats.map((s) => s.group).filter((g): g is NonNullable<typeof g> => Boolean(g));
  const batchIds = groups.map((g) => g.batchId);
  const [people, courseRows, passed, upcoming, batches] = await Promise.all([
    db.user.findMany({ where: { organizationId, id: { in: [...groups.map((g) => g.tutorId), ...notes.map((n) => n.tutorId)] } }, select: { id: true, name: true } }),
    db.course.findMany({ where: { organizationId, id: { in: seatOffers.map((o) => o.courseId) } }, select: { id: true, product: { select: { title: true } } } }),
    batchIds.length ? db.liveSession.groupBy({ by: ['batchId'], where: { organizationId, batchId: { in: batchIds }, status: { not: 'CANCELLED' }, endsAt: { lt: now } }, _count: { _all: true } }) : Promise.resolve([]),
    batchIds.length ? db.liveSession.findMany({ where: { organizationId, batchId: { in: batchIds }, status: 'SCHEDULED', startsAt: { gte: now } }, orderBy: { startsAt: 'asc' }, take: 300, select: { batchId: true, startsAt: true } }) : Promise.resolve([]),
    batchIds.length ? db.batch.findMany({ where: { organizationId, id: { in: batchIds } }, select: { id: true, endDate: true } }) : Promise.resolve([]),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const titleOfCourse = new Map(courseRows.map((c) => [c.id, c.product.title]));
  const titleOfOffer = new Map(seatOffers.map((o) => [o.id, titleOfCourse.get(o.courseId) ?? 'Course']));
  const passedOf = new Map(passed.map((p) => [p.batchId, p._count._all]));
  const endOf = new Map(batches.map((b) => [b.id, b.endDate]));
  const seatOf = new Map(seats.map((s) => [s.id, s]));

  const seatViews: TutoringSeatView[] = seats.map((s) => {
    const g = s.group;
    const end = g ? endOf.get(g.batchId) : null;
    return {
      id: s.id,
      offerId: s.offerId,
      title: titleOfOffer.get(s.offerId) ?? 'Course',
      status: s.status as TutoringSeatView['status'],
      askedTime: timeLabel(s.preferredMinute),
      askedFrom: s.preferredFrom,
      group: g
        ? {
            tutor: nameOf.get(g.tutorId) ?? 'To be confirmed',
            days: weekdaysLabel(g.weekdays),
            time: slotLabel({ weekdays: g.weekdays, startMinute: g.startMinute, minutes: g.classMinutes }),
            oneToOne: g.capacity <= 1,
            classesDone: Math.min(passedOf.get(g.batchId) ?? 0, g.classesTotal),
            classesTotal: g.classesTotal,
            finishesOn: end ? dayKey(end, timezone) : null,
            nextClassAt: upcoming.find((u) => u.batchId === g.batchId)?.startsAt ?? null,
          }
        : null,
    };
  });

  return {
    today,
    leaveMaxDays: LEARNER_LEAVE_MAX_DAYS,
    applies: seats.length > 0 || choices.length > 0,
    attention: choices.length + due.length,
    choices,
    feedbackDue: due.map((f) => ({ id: f.id, title: titleOfOffer.get(seatOf.get(f.seatId)?.offerId ?? '') ?? 'Your course', milestone: f.milestone, when: milestoneLabel(f.milestone) })),
    seats: seatViews,
    notes: notes.map((n) => ({ id: n.id, tutor: nameOf.get(n.tutorId) ?? 'Your tutor', milestone: n.milestone, when: milestoneLabel(n.milestone), rating: n.rating, comment: n.comment, submittedAt: n.submittedAt })),
    leave: leaves.map((l) => ({ id: l.id, fromDay: l.fromDay, toDay: l.toDay, classesMoved: l.classesMoved })),
  };
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** A learner picks their class time for a course taught with an online tutor, and is placed if somebody is free then. */
export async function chooseSlot(academy: Academy, userId: string, input: { offerId: string; time: unknown; fromDay: string }): Promise<Outcome> {
  const { organizationId, timezone } = academy;
  const offer = await db.tutoringOffer.findFirst({ where: { id: input.offerId, organizationId, active: true }, select: { id: true, courseId: true } });
  if (!offer) return { ok: false, error: 'That course is not offered with an online tutor.' };
  const course = await db.course.findFirst({ where: { id: offer.courseId, organizationId }, select: { productId: true } });
  const minute = minuteOf(input.time);
  if (minute == null) return { ok: false, error: 'Choose a class time.' };
  const today = dayKey(new Date(), timezone);
  const fromDay = input.fromDay || today;
  if (!isDay(fromDay) || fromDay < today) return { ok: false, error: 'Choose today or a later day to start.' };

  /*
   * The checks and the new seat in one transaction, behind a lock on this
   * learner and this course: two taps on the button (or the web and the
   * phone at once) would otherwise both pass the checks and make two seats.
   */
  const claimed = await db.$transaction(async (tx): Promise<{ ok: false; error: string } | { ok: true; seatId: string }> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tutoring-seat:${userId}:${offer.id}`}))`;
    const [enrolments, seats] = await Promise.all([
      course
        ? tx.enrollment.findMany({ where: { organizationId, userId, productId: course.productId, status: { in: ['ENROLLED', 'REGISTERED'] } }, orderBy: { createdAt: 'asc' }, select: { id: true } })
        : Promise.resolve([]),
      tx.tutoringSeat.findMany({ where: { organizationId, userId, status: { in: ['WAITING', 'PLACED', 'COMPLETED'] } }, select: { offerId: true, enrollmentId: true, status: true } }),
    ]);
    if (!enrolments.length) return { ok: false, error: 'Enrol on the course first, then choose your class time.' };
    if (seats.some((s) => s.offerId === offer.id && s.status !== 'COMPLETED')) return { ok: false, error: 'You have already chosen a time for this course.' };
    const enrolment = freeEnrolments(enrolments, seats)[0];
    if (!enrolment) return { ok: false, error: 'You have had your classes on this course. To take it again, enrol again or ask the office.' };
    const seat = await tx.tutoringSeat.create({ data: { organizationId, offerId: offer.id, userId, enrollmentId: enrolment.id, preferredMinute: minute, preferredFrom: fromDay }, select: { id: true } });
    return { ok: true, seatId: seat.id };
  });
  if (!claimed.ok) return { ok: false, error: claimed.error };

  try {
    const placed = await placeSeat(organizationId, claimed.seatId);
    return placed.placed
      ? { ok: true, message: `You are set: classes at ${timeLabel(minute)}. Your tutor and the dates are below.` }
      : { ok: true, message: 'That time has just been taken. You are on the list for it, and the office will offer you the nearest time.' };
  } catch (err) {
    if (err instanceof TutoringError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Leave of up to three days at a time, from today on; the tutor is told. */
export async function takeLeave(academy: Academy, userId: string, input: { seatId: string; fromDay: string; toDay: string; reason: string }): Promise<Outcome> {
  const fromDay = input.fromDay;
  const toDay = input.toDay || fromDay;
  const problem = learnerLeaveProblem(fromDay, toDay, dayKey(new Date(), academy.timezone));
  if (problem) return { ok: false, error: problem };
  try {
    const r = await applyLearnerLeave(academy.organizationId, { userId, seatId: input.seatId, fromDay, toDay, reason: input.reason.trim() });
    return {
      ok: true,
      message: r.moved
        ? `Leave noted and your tutor told. ${r.moved === 1 ? 'That class has' : `Those ${r.moved} classes have`} moved to the end of your course.`
        : r.excused
          ? 'Leave noted and your tutor told. The group class goes on; you are marked excused.'
          : 'Leave noted and your tutor told. There was no class on those days.',
    };
  } catch (err) {
    if (err instanceof TutoringError) return { ok: false, error: err.message };
    throw err;
  }
}

/** The learner on the tutor: an overall rating, three short questions and a few words. It goes to the office. */
export async function sendFeedback(
  academy: Academy,
  userId: string,
  input: { feedbackId: string; rating: unknown; clear?: unknown; punctual?: unknown; pace?: unknown; comment: string },
): Promise<Outcome> {
  const rating = scoreOf(input.rating);
  const comment = input.comment.trim().slice(0, 2000);
  const problem = learnerFeedbackProblem(rating, comment);
  if (problem) return { ok: false, error: problem };
  const answers = { clear: scoreOf(input.clear), punctual: scoreOf(input.punctual), pace: scoreOf(input.pace) };
  const n = await db.tutoringFeedback.updateMany({
    where: { id: input.feedbackId, organizationId: academy.organizationId, learnerId: userId, direction: 'LEARNER', submittedAt: null },
    data: { rating, answers, comment, submittedAt: new Date() },
  });
  if (!n.count) return { ok: false, error: 'That feedback has already been sent.' };
  return { ok: true, message: 'Thank you. The office reads every one.' };
}
