import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { WEEKDAY_LABELS, dayKey, todayKey } from '@/lib/clock';
import { hoursLabel, monthWindow } from '@/lib/payouts';
import { milestoneLabel, minuteOf, scoreOf, slotLabel, timeField, timeLabel, tutorLeaveProblem, tutorNoteProblem, weekdaysLabel } from './rules';
import { TutoringError, applyTutorLeave, changeSlot, tell, tutorHours } from './data';
import type { Academy, Outcome } from './learner';

/**
 * A tutor's side of online tutoring, once, for the web desk and the phone.
 *
 * What they see (the hours they can teach, their groups, the progress notes
 * due, their leave, the hours taught this month) and what they do (mark or
 * remove hours, ask for leave or withdraw it, move a class of their own
 * group, write a progress note). The office may do the first two for a
 * tutor as well; `actor.isOffice` says whether the person acting may.
 */

export interface Actor {
  id: string;
  isOffice: boolean;
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

const LEAVE_LABEL: Record<string, string> = { PENDING: 'waiting for the office', APPROVED: 'approved', REJECTED: 'not approved', WITHDRAWN: 'withdrawn' };

export interface TutorTutoringView {
  today: string;
  /** Whether the screen is worth a place in the menu: hours marked, a group, or a course they are listed to teach. */
  applies: boolean;
  hours: { id: string; weekday: number; day: string; from: string; to: string; label: string }[];
  groups: {
    id: string;
    batchId: string;
    course: string;
    days: string;
    time: string;
    /** "HH:MM", the start, for a form that moves it. */
    startTime: string;
    learners: string[];
    nextClassAt: Date | null;
  }[];
  notesDue: { id: string; learner: string; milestone: number; when: string }[];
  leave: { id: string; fromDay: string; toDay: string; status: string; statusLabel: string; canWithdraw: boolean }[];
  month: { label: string; minutes: number; hoursLabel: string; classes: number; unconfirmed: number };
}

export async function tutorTutoringView(academy: Academy, tutorId: string, now = new Date()): Promise<TutorTutoringView> {
  const { organizationId, timezone } = academy;
  const today = todayKey(timezone);
  const month = monthWindow(dayKey(now, timezone).slice(0, 7), timezone)!;

  const [windows, groups, leaves, notes, hours, listed] = await Promise.all([
    db.tutorAvailability.findMany({ where: { organizationId, userId: tutorId }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
    db.tutoringGroup.findMany({
      where: { organizationId, tutorId, status: 'ACTIVE' },
      orderBy: { startMinute: 'asc' },
      include: { offer: { select: { courseId: true } }, seats: { where: { status: 'PLACED' }, select: { userId: true } } },
    }),
    db.tutorLeave.findMany({ where: { organizationId, userId: tutorId }, orderBy: { fromDay: 'desc' }, take: 12 }),
    db.tutoringFeedback.findMany({ where: { organizationId, tutorId, direction: 'TUTOR', submittedAt: null }, orderBy: { dueAt: 'asc' }, take: 30 }),
    tutorHours(organizationId, month.from, month.to, timezone, now),
    db.tutoringTutor.count({ where: { userId: tutorId, offer: { organizationId, active: true } } }),
  ]);
  const [courses, people, next] = await Promise.all([
    db.course.findMany({ where: { organizationId, id: { in: groups.map((g) => g.offer.courseId) } }, select: { id: true, product: { select: { title: true } } } }),
    db.user.findMany({ where: { organizationId, id: { in: [...groups.flatMap((g) => g.seats.map((s) => s.userId)), ...notes.map((n) => n.learnerId)] } }, select: { id: true, name: true } }),
    groups.length
      ? db.liveSession.findMany({
          where: { organizationId, batchId: { in: groups.map((g) => g.batchId) }, status: 'SCHEDULED', startsAt: { gte: now } },
          orderBy: { startsAt: 'asc' },
          take: 200,
          select: { batchId: true, startsAt: true },
        })
      : Promise.resolve([]),
  ]);
  const titleOf = new Map(courses.map((c) => [c.id, c.product.title]));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const mine = hours.find((h) => h.userId === tutorId);

  return {
    today,
    applies: windows.length > 0 || groups.length > 0 || listed > 0,
    hours: windows.map((w) => ({
      id: w.id,
      weekday: w.weekday,
      day: WEEKDAY_LABELS[w.weekday],
      from: timeField(w.startMinute),
      to: timeField(w.endMinute),
      label: `${WEEKDAY_LABELS[w.weekday]} ${timeLabel(w.startMinute)} to ${timeLabel(w.endMinute)}`,
    })),
    groups: groups.map((g) => ({
      id: g.id,
      batchId: g.batchId,
      course: titleOf.get(g.offer.courseId) ?? 'Course',
      days: weekdaysLabel(g.weekdays),
      time: slotLabel({ weekdays: g.weekdays, startMinute: g.startMinute, minutes: g.classMinutes }),
      startTime: timeField(g.startMinute),
      learners: g.seats.map((s) => nameOf.get(s.userId) ?? 'Learner'),
      nextClassAt: next.find((s) => s.batchId === g.batchId)?.startsAt ?? null,
    })),
    notesDue: notes.map((n) => ({ id: n.id, learner: nameOf.get(n.learnerId) ?? 'Learner', milestone: n.milestone, when: milestoneLabel(n.milestone) })),
    leave: leaves.map((l) => ({ id: l.id, fromDay: l.fromDay, toDay: l.toDay, status: l.status, statusLabel: LEAVE_LABEL[l.status] ?? l.status.toLowerCase(), canWithdraw: l.status === 'PENDING' })),
    month: { label: month.label, minutes: mine?.minutes ?? 0, hoursLabel: hoursLabel(mine?.minutes ?? 0), classes: mine?.classes ?? 0, unconfirmed: mine?.unconfirmed ?? 0 },
  };
}

/** Hours a tutor can teach, on the weekdays given. A new window swallows what it overlaps that day. */
export async function addHours(academy: Academy, actor: Actor, input: { userId?: string; weekdays: number[]; from: unknown; to: unknown }): Promise<Outcome> {
  const { organizationId } = academy;
  const forUser = input.userId || actor.id;
  if (forUser !== actor.id && !actor.isOffice) return { ok: false, error: 'You can mark only your own hours.' };
  if (forUser !== actor.id) {
    const staff = await db.user.findFirst({ where: { id: forUser, organizationId, kind: 'STAFF' }, select: { id: true } });
    if (!staff) return { ok: false, error: 'That person is not on the team.' };
  }
  const weekdays = [...new Set(input.weekdays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  if (!weekdays.length) return { ok: false, error: 'Tick at least one day.' };
  const start = minuteOf(input.from);
  const end = minuteOf(input.to);
  if (start == null || end == null || end <= start) return { ok: false, error: 'The end time must be after the start time.' };

  const existing = await db.tutorAvailability.findMany({ where: { organizationId, userId: forUser, weekday: { in: weekdays } } });
  for (const day of weekdays) {
    const touching = existing.filter((w) => w.weekday === day && w.startMinute <= end && w.endMinute >= start);
    const from = Math.min(start, ...touching.map((w) => w.startMinute));
    const to = Math.max(end, ...touching.map((w) => w.endMinute));
    if (touching.length) await db.tutorAvailability.deleteMany({ where: { organizationId, id: { in: touching.map((w) => w.id) } } });
    await db.tutorAvailability.create({ data: { organizationId, userId: forUser, weekday: day, startMinute: from, endMinute: to } });
  }
  return { ok: true, message: 'Hours saved. New learners can be placed with you in them.' };
}

export async function removeHours(academy: Academy, actor: Actor, id: string): Promise<Outcome> {
  const row = await db.tutorAvailability.findFirst({ where: { id, organizationId: academy.organizationId }, select: { userId: true } });
  if (!row) return { ok: true, message: 'Removed.' };
  if (row.userId !== actor.id && !actor.isOffice) return { ok: false, error: 'You can change only your own hours.' };
  await db.tutorAvailability.deleteMany({ where: { id, organizationId: academy.organizationId } });
  return { ok: true, message: 'Removed. A group you already have stays where it is.' };
}

/** A tutor's own request waits for the office; leave the office enters for a tutor is approved as entered. */
export async function requestLeave(academy: Academy, actor: Actor, input: { userId?: string; fromDay: string; toDay: string; reason: string }): Promise<Outcome> {
  const { organizationId, timezone } = academy;
  const forUser = input.userId || actor.id;
  if (forUser !== actor.id && !actor.isOffice) return { ok: false, error: 'You can ask for leave only for yourself.' };
  const fromDay = input.fromDay;
  const toDay = input.toDay || fromDay;
  const problem = tutorLeaveProblem(fromDay, toDay, dayKey(new Date(), timezone));
  if (problem) return { ok: false, error: problem };
  const overlap = await db.tutorLeave.count({ where: { organizationId, userId: forUser, status: { in: ['PENDING', 'APPROVED'] }, fromDay: { lte: toDay }, toDay: { gte: fromDay } } });
  if (overlap) return { ok: false, error: 'There is already leave on some of those days.' };
  const reason = input.reason.trim().slice(0, 500);

  const direct = actor.isOffice && forUser !== actor.id;
  const leave = await db.tutorLeave.create({
    data: { organizationId, userId: forUser, fromDay, toDay, reason, status: direct ? 'APPROVED' : 'PENDING', decidedById: direct ? actor.id : null, decidedAt: direct ? new Date() : null },
    select: { id: true },
  });
  if (direct) await applyTutorLeave(organizationId, leave.id);
  await recordAudit({ organizationId, actorId: actor.id, action: direct ? 'tutoring.leave_entered' : 'tutoring.leave_requested', entity: 'TutorLeave', entityId: leave.id, after: { forUser, fromDay, toDay } });
  return { ok: true, message: direct ? 'Leave entered. The classes are rearranged and the learners told.' : 'Sent to the office. Nothing changes for your learners until it is approved.' };
}

export async function withdrawLeave(academy: Academy, actor: Actor, leaveId: string): Promise<Outcome> {
  const n = await db.tutorLeave.updateMany({ where: { id: leaveId, organizationId: academy.organizationId, userId: actor.id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
  if (!n.count) return { ok: false, error: 'Only a request still waiting can be withdrawn. For approved leave, speak to the office.' };
  return { ok: true, message: 'Withdrawn.' };
}

/** The group's own tutor, or the office, moves the time: for one day, or from a day on. The learners are told. */
export async function moveGroupTime(academy: Academy, actor: Actor, input: { groupId: string; time: unknown; fromDay: string; onlyThatDay: boolean }): Promise<Outcome> {
  const { organizationId } = academy;
  const group = await db.tutoringGroup.findFirst({ where: { id: input.groupId, organizationId }, select: { tutorId: true } });
  if (!group) return { ok: false, error: 'That group is gone.' };
  if (!actor.isOffice && group.tutorId !== actor.id) return { ok: false, error: 'Only the tutor of a group, or the office, can move its time.' };
  const minute = minuteOf(input.time);
  if (minute == null) return { ok: false, error: 'Choose the new time.' };
  if (!isDay(input.fromDay)) return { ok: false, error: 'Choose the day.' };
  try {
    const moved = await changeSlot(organizationId, input.groupId, { startMinute: minute, fromDay: input.fromDay, onlyThatDay: input.onlyThatDay });
    await recordAudit({ organizationId, actorId: actor.id, action: 'tutoring.slot_changed', entity: 'TutoringGroup', entityId: input.groupId, after: { minute, fromDay: input.fromDay, onlyThatDay: input.onlyThatDay, moved } });
    return { ok: true, message: `${moved} ${moved === 1 ? 'class' : 'classes'} moved to ${timeLabel(minute)}. The learners have been told.` };
  } catch (err) {
    if (err instanceof TutoringError) return { ok: false, error: err.message };
    throw err;
  }
}

/** The tutor on the learner: a progress note the learner, their parents and the office see. */
export async function sendProgressNote(
  academy: Academy,
  tutorId: string,
  input: { feedbackId: string; rating: unknown; attendance?: unknown; participation?: unknown; homework?: unknown; comment: string },
): Promise<Outcome> {
  const { organizationId } = academy;
  const rating = scoreOf(input.rating);
  const comment = input.comment.trim().slice(0, 2000);
  const problem = tutorNoteProblem(rating, comment);
  if (problem) return { ok: false, error: problem };
  const answers = { attendance: scoreOf(input.attendance), participation: scoreOf(input.participation), homework: scoreOf(input.homework) };
  const n = await db.tutoringFeedback.updateMany({
    where: { id: input.feedbackId, organizationId, tutorId, direction: 'TUTOR', submittedAt: null },
    data: { rating, answers, comment, submittedAt: new Date() },
  });
  if (!n.count) return { ok: false, error: 'That note has already been sent, or is not yours.' };
  const row = await db.tutoringFeedback.findFirst({ where: { id: input.feedbackId, organizationId }, select: { learnerId: true } });
  if (row) {
    await tell({
      organizationId,
      eventKey: 'tutoring.progress_note',
      userIds: [row.learnerId],
      subject: 'A progress note from your tutor',
      body: 'Hello {{name}}, your tutor has written a progress note on your online classes. It is under Online tutor in your portal.',
      dedupe: `note:${input.feedbackId}`,
    });
  }
  return { ok: true, message: 'Sent. The learner can read it.' };
}
