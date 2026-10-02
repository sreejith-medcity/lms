import { db } from '@/lib/db';
import { addDays, dayKey, dayStart, formatDayLabel } from '@/lib/clock';
import { queueNotifications } from '@/lib/notify';
import { provisionMeetings, releaseMeeting, syncMeeting } from '@/lib/zoom-sessions';
import {
  classDayOnOrAfter,
  classDays,
  clashes,
  daysBetween,
  hoursOf,
  milestoneLabel,
  milestonesDue,
  pickTutor,
  slotLabel,
  timeLabel,
  tutorLeavePlan,
  weekdaysLabel,
  type SlotShape,
  type TutorState,
} from '@/lib/tutoring/rules';

/**
 * Online tutoring against the database: placing a learner with a tutor,
 * the classes, leave on either side, a change of time or of tutor, the
 * feedback that falls due, and the hours for payroll. The rules themselves
 * are in rules.ts; this file reads and writes.
 *
 * A group's classes are ordinary LiveSessions in an ordinary batch (flagged
 * isTutoring), so the join links, the register, the calendar, the parent
 * portal and the payouts all work for it without knowing it is tutoring.
 */

export class TutoringError extends Error {}

const LIVE_ENROLMENT = ['ENROLLED', 'REGISTERED', 'COMPLETED'] as const;

/* ------------------------------------------------------------ telling people */

/**
 * A message in the academy's channels for this event, and the bell. The
 * wording travels with the row, so there is no template to keep in step.
 */
export async function tell(input: { organizationId: string; eventKey: string; userIds: string[]; subject: string; body: string; dedupe: string }): Promise<void> {
  const ids = [...new Set(input.userIds.filter(Boolean))];
  if (!ids.length) return;
  try {
    const people = await db.user.findMany({ where: { organizationId: input.organizationId, id: { in: ids } }, select: { id: true, name: true, email: true, phone: true } });
    await queueNotifications({
      organizationId: input.organizationId,
      eventKey: input.eventKey,
      recipients: people.map((p) => ({ userId: p.id, email: p.email, phone: p.phone })),
      dedupeKey: `${input.eventKey}:${input.dedupe}`,
      templateKey: 'inline',
      context: { _subject: input.subject, _body: input.body, title: input.subject },
      contextFor: (person) => ({ name: people.find((p) => p.id === person.userId)?.name ?? '' }),
    });
  } catch (err) {
    console.error(`[tutoring] ${input.eventKey}`, err instanceof Error ? err.message : err);
  }
}

async function zoneOf(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone ?? 'Asia/Kolkata';
}

const at = (day: string, minute: number, zone: string) => new Date(dayStart(day, zone).getTime() + minute * 60_000);

/* ------------------------------------------------------------ who is free */

/** Every tutor on an offer, with the hours they marked and the slots they already teach. */
export async function tutorStates(organizationId: string, offerId: string, fromDay: string): Promise<TutorState[]> {
  const offer = await db.tutoringOffer.findFirst({ where: { id: offerId, organizationId }, select: { tutors: { select: { userId: true } } } });
  const ids = offer?.tutors.map((t) => t.userId) ?? [];
  if (!ids.length) return [];
  const [staff, windows, groups, leaves] = await Promise.all([
    db.user.findMany({ where: { organizationId, id: { in: ids }, kind: 'STAFF', status: 'ACTIVE', deletedAt: null }, select: { id: true } }),
    db.tutorAvailability.findMany({ where: { organizationId, userId: { in: ids } }, select: { userId: true, weekday: true, startMinute: true, endMinute: true } }),
    db.tutoringGroup.findMany({ where: { organizationId, tutorId: { in: ids }, status: 'ACTIVE' }, select: { tutorId: true, weekdays: true, startMinute: true, classMinutes: true } }),
    db.tutorLeave.findMany({ where: { organizationId, userId: { in: ids }, status: 'APPROVED', fromDay: { lte: fromDay }, toDay: { gte: fromDay } }, select: { userId: true, fromDay: true, toDay: true } }),
  ]);
  const active = new Set(staff.map((s) => s.id));
  return ids
    .filter((id) => active.has(id))
    .map((userId) => ({
      userId,
      windows: windows.filter((w) => w.userId === userId),
      taken: groups.filter((g) => g.tutorId === userId).map((g) => ({ weekdays: g.weekdays, startMinute: g.startMinute, minutes: g.classMinutes })),
      /* Away for long on the day the learner would start: a short leave only moves classes. */
      away: leaves.some((l) => l.userId === userId && tutorLeavePlan(l.fromDay, l.toDay) === 'REASSIGN'),
    }));
}

/* ------------------------------------------------------------ classes */

async function ensureInstructor(userId: string): Promise<void> {
  await db.instructorProfile.upsert({ where: { userId }, create: { userId }, update: {} });
}

async function addClasses(input: { organizationId: string; batchId: string; tutorId: string; title: string; days: string[]; startMinute: number; minutes: number; zone: string }): Promise<number> {
  if (!input.days.length) return 0;
  const made = await db.liveSession.createManyAndReturn({
    data: input.days.map((day) => {
      const startsAt = at(day, input.startMinute, input.zone);
      return { organizationId: input.organizationId, batchId: input.batchId, title: input.title, startsAt, endsAt: new Date(startsAt.getTime() + input.minutes * 60_000), status: 'SCHEDULED' as const };
    }),
    select: { id: true },
  });
  await ensureInstructor(input.tutorId);
  await db.sessionInstructor.createMany({ data: made.map((s) => ({ sessionId: s.id, userId: input.tutorId, isPrimary: true })), skipDuplicates: true });
  return made.length;
}

type GroupRow = { id: string; organizationId: string; batchId: string; tutorId: string; weekdays: number[]; startMinute: number; classMinutes: number };

/** One more class after the last one in the diary: how a class called off is made up. */
async function appendClasses(group: GroupRow, count: number, zone: string, title: string): Promise<string | null> {
  if (count <= 0) return null;
  const last = await db.liveSession.findFirst({
    where: { organizationId: group.organizationId, batchId: group.batchId, status: { not: 'CANCELLED' } },
    orderBy: { startsAt: 'desc' },
    select: { startsAt: true },
  });
  const from = addDays(last ? dayKey(last.startsAt, zone) : dayKey(new Date(), zone), 1);
  const days = classDays(from, group.weekdays, count);
  await addClasses({ organizationId: group.organizationId, batchId: group.batchId, tutorId: group.tutorId, title, days, startMinute: group.startMinute, minutes: group.classMinutes, zone });
  const end = days[days.length - 1] ?? null;
  if (end) await db.batch.updateMany({ where: { id: group.batchId, organizationId: group.organizationId }, data: { endDate: dayStart(end, zone) } });
  return end;
}

/** Call off the group's classes on these days and add as many to the end. Returns how many, and the new last day. */
async function moveToEnd(group: GroupRow, fromDay: string, toDay: string, reason: string, zone: string): Promise<{ moved: number; endsOn: string | null }> {
  const sessions = await db.liveSession.findMany({
    where: { organizationId: group.organizationId, batchId: group.batchId, status: 'SCHEDULED', startsAt: { gte: dayStart(fromDay, zone), lt: dayStart(addDays(toDay, 1), zone) } },
    select: { id: true, title: true },
  });
  if (!sessions.length) return { moved: 0, endsOn: null };
  await db.liveSession.updateMany({ where: { organizationId: group.organizationId, id: { in: sessions.map((s) => s.id) } }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
  for (const s of sessions) await releaseMeeting(group.organizationId, s.id).catch(() => undefined);
  const endsOn = await appendClasses(group, sessions.length, zone, sessions[0].title);
  return { moved: sessions.length, endsOn };
}

async function learnersOf(organizationId: string, groupId: string): Promise<string[]> {
  const seats = await db.tutoringSeat.findMany({ where: { organizationId, groupId, status: 'PLACED' }, select: { userId: true } });
  return seats.map((s) => s.userId);
}

/* ------------------------------------------------------------ placing */

export interface Placement {
  placed: boolean;
  groupId?: string;
  reason?: string;
}

/**
 * Put a waiting learner with a tutor. A group course first looks for a group
 * at that time that has not begun and has a seat; otherwise the free tutor
 * carrying the least gets a new group, with every class in the diary.
 */
export async function placeSeat(organizationId: string, seatId: string, options: { tutorId?: string } = {}): Promise<Placement> {
  const seat = await db.tutoringSeat.findFirst({ where: { id: seatId, organizationId } });
  if (!seat || seat.status !== 'WAITING') return { placed: false, reason: 'That learner is not waiting.' };
  const offer = await db.tutoringOffer.findFirst({ where: { id: seat.offerId, organizationId }, select: { id: true, courseId: true, format: true, groupSize: true, classMinutes: true, classesTotal: true, weekdays: true, active: true } });
  if (!offer) return { placed: false, reason: 'That course is no longer offered with an online tutor.' };
  const course = await db.course.findFirst({ where: { id: offer.courseId, organizationId }, select: { id: true, productId: true, product: { select: { title: true } } } });
  if (!course) return { placed: false, reason: 'The course is gone.' };

  const zone = await zoneOf(organizationId);
  const today = dayKey(new Date(), zone);
  const startDay = classDayOnOrAfter(seat.preferredFrom > today ? seat.preferredFrom : today, offer.weekdays);
  if (!startDay) return { placed: false, reason: 'The course has no class days set.' };
  const slot: SlotShape = { weekdays: offer.weekdays, startMinute: seat.preferredMinute, minutes: offer.classMinutes };
  const capacity = offer.format === 'GROUP' ? Math.max(2, offer.groupSize) : 1;

  /* A group that has not begun, at this time, with a seat free. */
  if (capacity > 1 && !options.tutorId) {
    const open = await db.tutoringGroup.findMany({
      where: { organizationId, offerId: offer.id, status: 'ACTIVE', needsTutor: false, startMinute: slot.startMinute, startsOn: { gt: today } },
      orderBy: { startsOn: 'asc' },
      select: { id: true, capacity: true, _count: { select: { seats: { where: { status: 'PLACED' } } } } },
    });
    const room = open.find((g) => g._count.seats < g.capacity);
    if (room) {
      await seatInto(organizationId, seat.id, room.id);
      return { placed: true, groupId: room.id };
    }
  }

  const tutors = await tutorStates(organizationId, offer.id, startDay);
  const tutorId = options.tutorId
    ? tutors.find((t) => t.userId === options.tutorId && !t.taken.some((x) => clashes(x, slot)))?.userId ?? null
    : pickTutor(tutors, slot);
  if (!tutorId) {
    return { placed: false, reason: options.tutorId ? 'That tutor already teaches at that time.' : `No tutor is free at ${timeLabel(slot.startMinute)} on ${weekdaysLabel(slot.weekdays)}.` };
  }

  const [tutor, enrolment, branch] = await Promise.all([
    db.user.findFirst({ where: { id: tutorId, organizationId }, select: { name: true } }),
    seat.enrollmentId ? db.enrollment.findFirst({ where: { id: seat.enrollmentId, organizationId }, select: { branchId: true } }) : null,
    db.branch.findFirst({ where: { organizationId }, orderBy: { createdAt: 'asc' }, select: { id: true } }),
  ]);
  const branchId = enrolment?.branchId ?? branch?.id;
  if (!branchId) return { placed: false, reason: 'This academy has no branch configured.' };

  const days = classDays(startDay, offer.weekdays, offer.classesTotal);
  const title = `${course.product.title}: online class`;
  const batch = await db.batch.create({
    data: {
      organizationId,
      branchId,
      courseId: course.id,
      name: `Online · ${course.product.title} · ${tutor?.name ?? 'Tutor'} · ${timeLabel(slot.startMinute)}`.slice(0, 180),
      status: startDay <= today ? 'ACTIVE' : 'UPCOMING',
      startDate: dayStart(startDay, zone),
      endDate: days.length ? dayStart(days[days.length - 1], zone) : null,
      capacity,
      mode: 'ONLINE',
      isTutoring: true,
      staff: { create: { userId: tutorId, role: 'PRIMARY_TUTOR', startsOn: dayStart(startDay, zone) } },
    },
    select: { id: true },
  });
  const group = await db.tutoringGroup.create({
    data: { organizationId, offerId: offer.id, batchId: batch.id, tutorId, weekdays: offer.weekdays, startMinute: slot.startMinute, classMinutes: offer.classMinutes, capacity, classesTotal: offer.classesTotal, startsOn: startDay },
    select: { id: true },
  });
  await addClasses({ organizationId, batchId: batch.id, tutorId, title, days, startMinute: slot.startMinute, minutes: offer.classMinutes, zone });
  await seatInto(organizationId, seat.id, group.id);
  /* The first few rooms now; the rest are made a fortnight before each class, as for any batch. */
  await provisionMeetings(organizationId, { limit: 4 }).catch(() => undefined);
  return { placed: true, groupId: group.id };
}

/** The learner takes their seat: the enrolment moves into the group's batch, and both sides are told. */
async function seatInto(organizationId: string, seatId: string, groupId: string): Promise<void> {
  const [seat, group] = await Promise.all([
    db.tutoringSeat.findFirst({ where: { id: seatId, organizationId } }),
    db.tutoringGroup.findFirst({ where: { id: groupId, organizationId }, include: { offer: { select: { courseId: true } } } }),
  ]);
  if (!seat || !group) return;
  const course = await db.course.findFirst({ where: { id: group.offer.courseId, organizationId }, select: { productId: true, product: { select: { title: true } } } });
  if (!course) return;
  const batch = await db.batch.findFirst({ where: { id: group.batchId, organizationId }, select: { branchId: true } });

  /* One enrolment per learner and course here: the one they bought, moved into the group's batch, or a new one. */
  const held = await db.enrollment.findFirst({
    where: { organizationId, userId: seat.userId, productId: course.productId, status: { in: [...LIVE_ENROLMENT] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, batchId: true },
  });
  let enrollmentId = seat.enrollmentId ?? held?.id ?? null;
  if (held) {
    if (held.batchId !== group.batchId) await db.enrollment.update({ where: { id: held.id }, data: { batchId: group.batchId, status: 'ENROLLED' } });
    enrollmentId = held.id;
  } else if (batch) {
    const made = await db.enrollment.create({
      data: { organizationId, branchId: batch.branchId, userId: seat.userId, productId: course.productId, batchId: group.batchId, status: 'ENROLLED', source: 'ADMIN_SINGLE', startsAt: new Date() },
      select: { id: true },
    });
    enrollmentId = made.id;
  }
  await db.tutoringSeat.update({ where: { id: seat.id }, data: { status: 'PLACED', groupId, enrollmentId, placedAt: new Date() } });

  const zone = await zoneOf(organizationId);
  const tutor = await db.user.findFirst({ where: { id: group.tutorId, organizationId }, select: { name: true } });
  const learner = await db.user.findFirst({ where: { id: seat.userId, organizationId }, select: { name: true } });
  const when = `${weekdaysLabel(group.weekdays)}, ${slotLabel({ weekdays: group.weekdays, startMinute: group.startMinute, minutes: group.classMinutes })}`;
  const first = formatDayLabel(group.startsOn, zone, true);
  await tell({
    organizationId,
    eventKey: 'tutoring.assigned',
    userIds: [seat.userId],
    subject: `Your online classes for ${course.product.title} are set`,
    body: `Hello {{name}}, your tutor for ${course.product.title} is ${tutor?.name ?? 'being confirmed'}. Classes are ${when}, starting ${first}. The join link is on your calendar before each class.`,
    dedupe: `seat:${seat.id}`,
  });
  await tell({
    organizationId,
    eventKey: 'tutoring.assigned',
    userIds: [group.tutorId],
    subject: `A new online learner: ${learner?.name ?? 'a learner'}`,
    body: `Hello {{name}}, ${learner?.name ?? 'a learner'} has been placed with you for ${course.product.title}: ${when}, starting ${first}.`,
    dedupe: `seat:${seat.id}:tutor`,
  });
}

/* ------------------------------------------------------------ leave */

export interface LeaveOutcome {
  plan: 'CANCEL' | 'REASSIGN';
  classesMoved: number;
  handedOver: { groupId: string; to: string }[];
  needsTutor: string[];
}

/**
 * What approving a tutor's leave does. Up to seven days: the classes on
 * those days are called off and added to the end. Longer: each group goes
 * to another tutor free at that time from the first day of the leave; a
 * group nobody can take has its classes moved to the end and is flagged
 * for the office.
 */
export async function applyTutorLeave(organizationId: string, leaveId: string): Promise<LeaveOutcome | null> {
  const leave = await db.tutorLeave.findFirst({ where: { id: leaveId, organizationId } });
  if (!leave) return null;
  const plan = tutorLeavePlan(leave.fromDay, leave.toDay);
  if (!plan) return null;
  const zone = await zoneOf(organizationId);
  const today = dayKey(new Date(), zone);
  const from = leave.fromDay > today ? leave.fromDay : today;
  const groups = await db.tutoringGroup.findMany({ where: { organizationId, tutorId: leave.userId, status: 'ACTIVE' } });
  const tutor = await db.user.findFirst({ where: { id: leave.userId, organizationId }, select: { name: true } });
  const outcome: LeaveOutcome = { plan, classesMoved: 0, handedOver: [], needsTutor: [] };
  const range = leave.fromDay === leave.toDay ? formatDayLabel(leave.fromDay, zone, true) : `${formatDayLabel(from, zone)} to ${formatDayLabel(leave.toDay, zone)}`;

  for (const g of groups) {
    const learners = await learnersOf(organizationId, g.id);
    if (plan === 'REASSIGN') {
      const others = await tutorStates(organizationId, g.offerId, from);
      const next = pickTutor(others, { weekdays: g.weekdays, startMinute: g.startMinute, minutes: g.classMinutes }, [leave.userId]);
      if (next) {
        await reassignGroup(organizationId, g.id, next, from, `${tutor?.name ?? 'Your tutor'} is on leave`);
        outcome.handedOver.push({ groupId: g.id, to: next });
        continue;
      }
      outcome.needsTutor.push(g.id);
      await db.tutoringGroup.update({ where: { id: g.id }, data: { needsTutor: true } });
    }
    const { moved, endsOn } = await moveToEnd(g, from, leave.toDay, 'Your tutor is on leave', zone);
    outcome.classesMoved += moved;
    if (moved > 0) {
      await tell({
        organizationId,
        eventKey: 'tutoring.class_cancelled',
        userIds: learners,
        subject: `No online class ${range}`,
        body: `Hello {{name}}, ${tutor?.name ?? 'your tutor'} is on leave ${range}, so ${moved === 1 ? 'that class is' : `those ${moved} classes are`} off. ${moved === 1 ? 'It has' : 'They have'} been added to the end of your course${endsOn ? `, which now finishes on ${formatDayLabel(endsOn, zone, true)}` : ''}. You lose no classes.`,
        dedupe: `leave:${leave.id}:${g.id}`,
      });
    }
  }
  await db.tutorLeave.update({ where: { id: leave.id }, data: { outcome: outcome as unknown as object } });
  return outcome;
}

/** The group goes to another tutor from a day on: the classes from then are theirs, the learners are told. */
export async function reassignGroup(organizationId: string, groupId: string, tutorId: string, fromDay: string, why = ''): Promise<void> {
  const group = await db.tutoringGroup.findFirst({ where: { id: groupId, organizationId }, include: { offer: { select: { courseId: true } } } });
  if (!group) throw new TutoringError('That group is gone.');
  if (group.tutorId === tutorId) {
    await db.tutoringGroup.update({ where: { id: group.id }, data: { needsTutor: false } });
    return;
  }
  const zone = await zoneOf(organizationId);
  const slot: SlotShape = { weekdays: group.weekdays, startMinute: group.startMinute, minutes: group.classMinutes };
  const theirs = await db.tutoringGroup.findMany({ where: { organizationId, tutorId, status: 'ACTIVE', id: { not: group.id } }, select: { weekdays: true, startMinute: true, classMinutes: true } });
  if (theirs.some((g) => clashes({ weekdays: g.weekdays, startMinute: g.startMinute, minutes: g.classMinutes }, slot))) throw new TutoringError('That tutor already teaches at that time.');
  const [next, previous, course] = await Promise.all([
    db.user.findFirst({ where: { id: tutorId, organizationId, kind: 'STAFF' }, select: { name: true } }),
    db.user.findFirst({ where: { id: group.tutorId, organizationId }, select: { name: true } }),
    db.course.findFirst({ where: { id: group.offer.courseId, organizationId }, select: { product: { select: { title: true } } } }),
  ]);
  if (!next) throw new TutoringError('That tutor is not on the team.');
  const since = dayStart(fromDay, zone);
  const upcoming = await db.liveSession.findMany({ where: { organizationId, batchId: group.batchId, status: 'SCHEDULED', startsAt: { gte: since } }, select: { id: true } });
  const ids = upcoming.map((s) => s.id);

  await ensureInstructor(tutorId);
  await db.$transaction([
    db.tutoringGroup.update({ where: { id: group.id }, data: { tutorId, needsTutor: false } }),
    /* One tutor on the batch at a time; who taught which class stays on the classes themselves. */
    db.batchStaff.deleteMany({ where: { batchId: group.batchId, userId: group.tutorId, role: 'PRIMARY_TUTOR', batch: { organizationId } } }),
    db.batchStaff.upsert({
      where: { batchId_userId_role: { batchId: group.batchId, userId: tutorId, role: 'PRIMARY_TUTOR' } },
      create: { batchId: group.batchId, userId: tutorId, role: 'PRIMARY_TUTOR', startsOn: since },
      update: { startsOn: since, endsOn: null },
    }),
    db.sessionInstructor.deleteMany({ where: { sessionId: { in: ids } } }),
    db.sessionInstructor.createMany({ data: ids.map((sessionId) => ({ sessionId, userId: tutorId, isPrimary: true })), skipDuplicates: true }),
    db.batch.updateMany({
      where: { id: group.batchId, organizationId },
      data: { name: `Online · ${course?.product.title ?? 'Course'} · ${next.name} · ${timeLabel(group.startMinute)}`.slice(0, 180) },
    }),
  ]);

  const learners = await learnersOf(organizationId, group.id);
  const day = formatDayLabel(fromDay, zone, true);
  await tell({
    organizationId,
    eventKey: 'tutoring.tutor_changed',
    userIds: learners,
    subject: `Your online tutor from ${day}: ${next.name}`,
    body: `Hello {{name}}, from ${day} your online classes are with ${next.name}${why ? ` (${why})` : ''}. The time stays the same: ${slotLabel(slot)}. You lose no classes.`,
    dedupe: `reassign:${group.id}:${tutorId}:${fromDay}`,
  });
  await tell({
    organizationId,
    eventKey: 'tutoring.tutor_changed',
    userIds: [tutorId],
    subject: `An online group is yours from ${day}`,
    body: `Hello {{name}}, you take over ${course?.product.title ?? 'a course'} at ${slotLabel(slot)}, ${weekdaysLabel(group.weekdays)}, from ${day}${previous ? `, from ${previous.name}` : ''}. The classes are on your calendar.`,
    dedupe: `reassign:${group.id}:${tutorId}:${fromDay}:tutor`,
  });
}

/**
 * A change of time. For one day, that day's class moves; for good, every
 * class from the day on moves and the group keeps the new time. The tutor
 * must have nothing else then. The learners are told either way.
 */
export async function changeSlot(organizationId: string, groupId: string, input: { startMinute: number; fromDay: string; onlyThatDay: boolean }): Promise<number> {
  const group = await db.tutoringGroup.findFirst({ where: { id: groupId, organizationId } });
  if (!group || group.status !== 'ACTIVE') throw new TutoringError('That group is not running.');
  if (input.startMinute + group.classMinutes > 24 * 60) throw new TutoringError('That class would run past midnight.');
  const zone = await zoneOf(organizationId);
  const today = dayKey(new Date(), zone);
  if (input.fromDay < today) throw new TutoringError('Choose today or a later day.');
  const slot: SlotShape = { weekdays: group.weekdays, startMinute: input.startMinute, minutes: group.classMinutes };
  const others = await db.tutoringGroup.findMany({ where: { organizationId, tutorId: group.tutorId, status: 'ACTIVE', id: { not: group.id } }, select: { weekdays: true, startMinute: true, classMinutes: true } });
  if (others.some((g) => clashes({ weekdays: g.weekdays, startMinute: g.startMinute, minutes: g.classMinutes }, slot))) throw new TutoringError('The tutor has another online class at that time.');

  const sessions = await db.liveSession.findMany({
    where: {
      organizationId,
      batchId: group.batchId,
      status: 'SCHEDULED',
      startsAt: input.onlyThatDay ? { gte: dayStart(input.fromDay, zone), lt: dayStart(addDays(input.fromDay, 1), zone) } : { gte: dayStart(input.fromDay, zone) },
    },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true },
  });
  if (!sessions.length) throw new TutoringError(input.onlyThatDay ? 'There is no class on that day.' : 'There are no classes left to move.');
  for (const s of sessions) {
    const startsAt = at(dayKey(s.startsAt, zone), input.startMinute, zone);
    await db.liveSession.update({ where: { id: s.id }, data: { startsAt, endsAt: new Date(startsAt.getTime() + group.classMinutes * 60_000) } });
  }
  /* The rooms already made follow the class; a handful now, the rest when the fortnightly run reaches them. */
  for (const s of sessions.slice(0, 6)) await syncMeeting(organizationId, s.id).catch(() => undefined);
  if (!input.onlyThatDay) {
    await db.tutoringGroup.update({ where: { id: group.id }, data: { startMinute: input.startMinute } });
    const batch = await db.batch.findFirst({ where: { id: group.batchId, organizationId }, select: { name: true } });
    if (batch) await db.batch.updateMany({ where: { id: group.batchId, organizationId }, data: { name: batch.name.replace(/ · [^·]+$/, ` · ${timeLabel(input.startMinute)}`) } });
  }

  const learners = await learnersOf(organizationId, group.id);
  const day = formatDayLabel(input.fromDay, zone, true);
  const was = slotLabel({ weekdays: group.weekdays, startMinute: group.startMinute, minutes: group.classMinutes });
  await tell({
    organizationId,
    eventKey: 'tutoring.slot_changed',
    userIds: learners,
    subject: input.onlyThatDay ? `Your online class on ${day} is at ${timeLabel(input.startMinute)}` : `Your online classes move to ${timeLabel(input.startMinute)} from ${day}`,
    body: input.onlyThatDay
      ? `Hello {{name}}, your tutor is not free at the usual time on ${day}. That day's class is at ${slotLabel(slot)} instead of ${was}. Every other class stays as it is.`
      : `Hello {{name}}, from ${day} your online classes are at ${slotLabel(slot)} instead of ${was}, on the same days. If that time does not suit you, tell the office and we will find another.`,
    dedupe: `slot:${group.id}:${input.fromDay}:${input.startMinute}:${input.onlyThatDay ? 'day' : 'on'}`,
  });
  return sessions.length;
}

/**
 * A learner's leave. One to one, the classes on those days move to the end
 * and the tutor's time is free; in a group the class goes on and the learner
 * is marked excused. The tutor is told either way.
 */
export async function applyLearnerLeave(organizationId: string, input: { userId: string; seatId: string; fromDay: string; toDay: string; reason: string }): Promise<{ moved: number; excused: number }> {
  const seat = await db.tutoringSeat.findFirst({ where: { id: input.seatId, organizationId, userId: input.userId, status: 'PLACED' }, include: { group: true } });
  if (!seat?.group) throw new TutoringError('You have no online classes running.');
  const group = seat.group;
  const zone = await zoneOf(organizationId);
  const clash = await db.learnerLeave.count({ where: { organizationId, seatId: seat.id, status: 'APPROVED', fromDay: { lte: input.toDay }, toDay: { gte: input.fromDay } } });
  if (clash) throw new TutoringError('You already have leave on some of those days.');

  let moved = 0;
  let excused = 0;
  let endsOn: string | null = null;
  if (group.capacity <= 1) {
    const r = await moveToEnd(group, input.fromDay, input.toDay, 'The learner is on leave', zone);
    moved = r.moved;
    endsOn = r.endsOn;
  } else {
    const sessions = await db.liveSession.findMany({
      where: { organizationId, batchId: group.batchId, status: 'SCHEDULED', startsAt: { gte: dayStart(input.fromDay, zone), lt: dayStart(addDays(input.toDay, 1), zone) } },
      select: { id: true },
    });
    for (const s of sessions) {
      await db.attendance.upsert({
        where: { sessionId_userId: { sessionId: s.id, userId: input.userId } },
        create: { sessionId: s.id, userId: input.userId, status: 'EXCUSED', source: 'REGISTER', note: 'On leave' },
        update: { status: 'EXCUSED', note: 'On leave' },
      });
    }
    excused = sessions.length;
  }
  await db.learnerLeave.create({ data: { organizationId, userId: input.userId, seatId: seat.id, fromDay: input.fromDay, toDay: input.toDay, reason: input.reason.slice(0, 500), classesMoved: moved } });

  const learner = await db.user.findFirst({ where: { id: input.userId, organizationId }, select: { name: true } });
  const range = input.fromDay === input.toDay ? formatDayLabel(input.fromDay, zone, true) : `${formatDayLabel(input.fromDay, zone)} to ${formatDayLabel(input.toDay, zone)}`;
  await tell({
    organizationId,
    eventKey: 'tutoring.learner_leave',
    userIds: [group.tutorId],
    subject: `${learner?.name ?? 'A learner'} is on leave ${range}`,
    body:
      group.capacity <= 1
        ? `Hello {{name}}, ${learner?.name ?? 'your learner'} is on leave ${range}${input.reason ? ` (${input.reason})` : ''}. ${moved === 1 ? 'That class is' : `Those ${moved} classes are`} off and added to the end of the course${endsOn ? `, which now finishes on ${formatDayLabel(endsOn, zone, true)}` : ''}.`
        : `Hello {{name}}, ${learner?.name ?? 'a learner'} in your group is on leave ${range}${input.reason ? ` (${input.reason})` : ''}. The class goes on for the others; they are marked excused.`,
    dedupe: `learner-leave:${seat.id}:${input.fromDay}:${input.toDay}`,
  });
  return { moved, excused };
}

/* ------------------------------------------------------------ the sweep */

/**
 * What the scheduled job does for online tutoring, across every academy:
 * a class whose register is in is marked held; feedback that has fallen due
 * is asked for, both ways; a group whose last class has passed is closed;
 * learners still waiting for a tutor are tried again.
 */
export async function sweepTutoring(now = new Date()): Promise<{ held: number; asked: number; finished: number; placed: number }> {
  const out = { held: 0, asked: 0, finished: 0, placed: 0 };

  // tenant-safe: every academy's tutoring classes whose register is in; each row is updated by its own id.
  const done = await db.liveSession.updateMany({
    where: { status: { in: ['SCHEDULED', 'LIVE'] }, endsAt: { lt: now }, registerSubmittedAt: { not: null }, batch: { isTutoring: true } },
    data: { status: 'COMPLETED' },
  });
  out.held = done.count;

  // tenant-safe: the sweep walks every academy's running groups; each is handled inside its own organizationId below.
  const groups = await db.tutoringGroup.findMany({ where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'asc' }, take: 300, include: { offer: { select: { courseId: true } } } });
  for (const g of groups) {
    const organizationId = g.organizationId;
    /* A class counts toward feedback and the end once its time has passed and it was not called off. */
    const passed = await db.liveSession.count({ where: { organizationId, batchId: g.batchId, status: { not: 'CANCELLED' }, endsAt: { lt: now } } });
    /* Nothing falls due before the fifth class, or the last one of a shorter course. */
    if (passed < Math.min(5, g.classesTotal)) continue;
    const seats = await db.tutoringSeat.findMany({ where: { organizationId, groupId: g.id, status: 'PLACED' }, select: { id: true, userId: true } });
    const course = await db.course.findFirst({ where: { id: g.offer.courseId, organizationId }, select: { product: { select: { title: true } } } });
    const title = course?.product.title ?? 'your course';
    for (const seat of seats) {
      const asked = await db.tutoringFeedback.findMany({ where: { organizationId, seatId: seat.id, direction: 'LEARNER' }, select: { milestone: true } });
      const due = milestonesDue(passed, g.classesTotal, asked.map((a) => a.milestone));
      for (const milestone of due) {
        await db.tutoringFeedback.createMany({
          data: (['LEARNER', 'TUTOR'] as const).map((direction) => ({ organizationId, seatId: seat.id, groupId: g.id, learnerId: seat.userId, tutorId: g.tutorId, milestone, direction })),
          skipDuplicates: true,
        });
        out.asked += 1;
        const label = milestoneLabel(milestone).toLowerCase();
        await tell({
          organizationId,
          eventKey: 'tutoring.feedback_due',
          userIds: [seat.userId],
          subject: `How are your online classes going?`,
          body: `Hello {{name}}, ${label} of ${title} we ask how the classes are going. It takes a minute, under Online tutor in your portal, and it goes to the office, not to your tutor's inbox.`,
          dedupe: `feedback:${seat.id}:${milestone}:learner`,
        });
        await tell({
          organizationId,
          eventKey: 'tutoring.feedback_due',
          userIds: [g.tutorId],
          subject: `A progress note is due`,
          body: `Hello {{name}}, ${label} of ${title} a short progress note on your learner is due. It is on My teaching, Online tutoring; the learner and the office see it.`,
          dedupe: `feedback:${seat.id}:${milestone}:tutor`,
        });
      }
    }
    if (passed >= g.classesTotal) {
      const left = await db.liveSession.count({ where: { organizationId, batchId: g.batchId, status: 'SCHEDULED', endsAt: { gte: now } } });
      if (left === 0) {
        await db.$transaction([
          db.tutoringGroup.update({ where: { id: g.id }, data: { status: 'COMPLETED' } }),
          db.tutoringSeat.updateMany({ where: { organizationId, groupId: g.id, status: 'PLACED' }, data: { status: 'COMPLETED', completedAt: now } }),
          db.batch.updateMany({ where: { id: g.batchId, organizationId }, data: { status: 'COMPLETED' } }),
        ]);
        out.finished += 1;
      }
    } else {
      await db.tutoringGroup.update({ where: { id: g.id }, data: { updatedAt: now } });
    }
  }

  // tenant-safe: waiting learners of every academy; placeSeat works inside the seat's own academy.
  const waiting = await db.tutoringSeat.findMany({ where: { status: 'WAITING' }, orderBy: { createdAt: 'asc' }, take: 20, select: { id: true, organizationId: true } });
  for (const w of waiting) {
    const r = await placeSeat(w.organizationId, w.id).catch(() => ({ placed: false }));
    if (r.placed) out.placed += 1;
  }
  return out;
}

/* ------------------------------------------------------------ hours */

export interface TutorHours {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  employeeCode: string | null;
  classes: number;
  minutes: number;
  hours: number;
  /** Classes whose time has passed with no register in: not counted until confirmed. */
  unconfirmed: number;
  days: { date: string; classes: number; minutes: number }[];
}

/**
 * Online class hours per tutor in a window, for payroll. A class counts
 * once it is held: its register is in, or the meeting ended on Zoom. A
 * class whose time passed with neither is listed as unconfirmed and adds
 * nothing, so an hour is never paid on the diary's word alone.
 */
export async function tutorHours(organizationId: string, from: Date, to: Date, zone: string, now = new Date()): Promise<TutorHours[]> {
  const sessions = await db.liveSession.findMany({
    where: { organizationId, batch: { isTutoring: true }, isHoliday: false, status: { not: 'CANCELLED' }, startsAt: { gte: from, lt: to }, endsAt: { lt: now } },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true, endsAt: true, status: true, registerSubmittedAt: true, batchId: true, instructors: { select: { userId: true } } },
  });
  const batchIds = [...new Set(sessions.map((s) => s.batchId).filter((x): x is string => Boolean(x)))];
  const groups = batchIds.length ? await db.tutoringGroup.findMany({ where: { organizationId, batchId: { in: batchIds } }, select: { batchId: true, tutorId: true } }) : [];
  const tutorOfBatch = new Map(groups.map((g) => [g.batchId, g.tutorId]));
  const by = new Map<string, { classes: number; minutes: number; unconfirmed: number; days: Map<string, { classes: number; minutes: number }> }>();
  for (const s of sessions) {
    const who = s.instructors.length ? s.instructors.map((i) => i.userId) : [tutorOfBatch.get(s.batchId ?? '') ?? ''].filter(Boolean);
    const minutes = Math.max(0, Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000));
    const held = s.status === 'COMPLETED' || s.registerSubmittedAt != null;
    for (const userId of who) {
      const row = by.get(userId) ?? { classes: 0, minutes: 0, unconfirmed: 0, days: new Map() };
      if (held) {
        row.classes += 1;
        row.minutes += minutes;
        const day = dayKey(s.startsAt, zone);
        const d = row.days.get(day) ?? { classes: 0, minutes: 0 };
        d.classes += 1;
        d.minutes += minutes;
        row.days.set(day, d);
      } else {
        row.unconfirmed += 1;
      }
      by.set(userId, row);
    }
  }
  const people = by.size
    ? await db.user.findMany({ where: { organizationId, id: { in: [...by.keys()] } }, select: { id: true, name: true, email: true, phone: true, instructorProfile: { select: { employeeCode: true } } } })
    : [];
  return people
    .map((p) => {
      const row = by.get(p.id)!;
      return {
        userId: p.id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        employeeCode: p.instructorProfile?.employeeCode ?? null,
        classes: row.classes,
        minutes: row.minutes,
        hours: hoursOf(row.minutes),
        unconfirmed: row.unconfirmed,
        days: [...row.days.entries()].map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How many days of approved leave a learner has taken on a seat. */
export async function leaveDaysTaken(organizationId: string, seatId: string): Promise<number> {
  const rows = await db.learnerLeave.findMany({ where: { organizationId, seatId, status: 'APPROVED' }, select: { fromDay: true, toDay: true } });
  return rows.reduce((n, r) => n + daysBetween(r.fromDay, r.toDay), 0);
}

/** Does this learner have an online tutor, or a course that is taught with one? Decides whether their menu shows the item. */
export async function hasTutoring(organizationId: string, userId: string): Promise<boolean> {
  const seat = await db.tutoringSeat.count({ where: { organizationId, userId, status: { in: ['WAITING', 'PLACED', 'COMPLETED'] } } });
  if (seat) return true;
  const offers = await db.tutoringOffer.findMany({ where: { organizationId, active: true }, select: { courseId: true } });
  if (!offers.length) return false;
  const enrolled = await db.enrollment.count({
    where: { organizationId, userId, status: { in: ['ENROLLED', 'REGISTERED'] }, product: { course: { id: { in: offers.map((o) => o.courseId) } } } },
  });
  return enrolled > 0;
}

/** A learner's progress notes from their online tutor, newest first: for the learner's parents. */
export async function progressNotes(organizationId: string, learnerId: string): Promise<{ id: string; tutor: string; milestone: number; rating: number | null; comment: string; at: Date }[]> {
  const rows = await db.tutoringFeedback.findMany({
    where: { organizationId, learnerId, direction: 'TUTOR', submittedAt: { not: null } },
    orderBy: { submittedAt: 'desc' },
    take: 12,
    select: { id: true, tutorId: true, milestone: true, rating: true, comment: true, submittedAt: true },
  });
  if (!rows.length) return [];
  const tutors = await db.user.findMany({ where: { organizationId, id: { in: rows.map((r) => r.tutorId) } }, select: { id: true, name: true } });
  const nameOf = new Map(tutors.map((t) => [t.id, t.name]));
  return rows.map((r) => ({ id: r.id, tutor: nameOf.get(r.tutorId) ?? 'The tutor', milestone: r.milestone, rating: r.rating, comment: r.comment, at: r.submittedAt! }));
}
