'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser, requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { can } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { dayKey } from '@/lib/clock';
import type { ActionState } from '@/server/courses';
import { phoneVariants } from '@/lib/exams/perms';
import { minuteOf, timeLabel } from '@/lib/tutoring/rules';
import { TutoringError, applyTutorLeave, placeSeat, reassignGroup, tell } from '@/lib/tutoring/data';
import { chooseSlot, sendFeedback, takeLeave } from '@/lib/tutoring/learner';
import { addHours, moveGroupTime, removeHours, requestLeave, sendProgressNote, withdrawLeave } from '@/lib/tutoring/tutor';

/**
 * Online tutoring: what the office, a tutor and a learner can each do.
 *
 * The office (whoever may schedule classes) sets which courses are offered
 * with an online tutor and who teaches them, enrols learners, approves a
 * tutor's leave, and can move a group to another tutor or another time. A
 * tutor marks their own hours, asks for leave, changes the time of their own
 * group and writes progress notes. A learner picks their class time, takes
 * leave and gives feedback.
 */

const OFFICE = 'scheduling.sessions';

async function office(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(OFFICE, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

async function anyStaff() {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff()]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user, isOffice: can(user.permissions, OFFICE, 'edit') };
}

async function learner() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user || user.organizationId !== tenant.organizationId) throw new Error('UNAUTHORIZED');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  if (err instanceof TutoringError) return { error: err.message };
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[tutoring]', message);
  return { error: 'Something went wrong. Please try again.' };
}

function refresh() {
  revalidatePath('/admin/tutoring', 'layout');
  revalidatePath('/admin/desk/tutoring');
  revalidatePath('/learn/tutoring');
}

const weekdaysFrom = (formData: FormData) =>
  [...new Set(formData.getAll('weekdays').map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/* ------------------------------------------------------------ the office: courses and tutors */

export async function saveOfferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await office();
    const courseId = String(formData.get('courseId') ?? '');
    const course = await db.course.findFirst({ where: { id: courseId, organizationId: tenant.organizationId }, select: { id: true, product: { select: { title: true } } } });
    if (!course) return { error: 'Choose a course.' };
    const format = formData.get('format') === 'GROUP' ? 'GROUP' : 'ONE_TO_ONE';
    const groupSize = format === 'GROUP' ? Math.round(Number(formData.get('groupSize') ?? 0)) : 1;
    if (format === 'GROUP' && (groupSize < 2 || groupSize > 30)) return { error: 'A group is from 2 to 30 learners.' };
    const classMinutes = Math.round(Number(formData.get('classMinutes') ?? 0));
    if (classMinutes < 15 || classMinutes > 240) return { error: 'A class is from 15 minutes to 4 hours.' };
    const classesTotal = Math.round(Number(formData.get('classesTotal') ?? 0));
    if (classesTotal < 1 || classesTotal > 365) return { error: 'From 1 to 365 classes.' };
    const weekdays = weekdaysFrom(formData);
    if (!weekdays.length) return { error: 'Tick at least one class day.' };
    const picked = [...new Set(formData.getAll('tutors').map(String).filter(Boolean))];
    const tutors = await db.user.findMany({ where: { organizationId: tenant.organizationId, id: { in: picked }, kind: 'STAFF', deletedAt: null }, select: { id: true } });
    const active = formData.get('active') === 'on';

    const offer = await db.tutoringOffer.upsert({
      where: { courseId: course.id },
      create: { organizationId: tenant.organizationId, courseId: course.id, format, groupSize, classMinutes, classesTotal, weekdays, active },
      update: { format, groupSize, classMinutes, classesTotal, weekdays, active },
      select: { id: true },
    });
    await db.$transaction([
      db.tutoringTutor.deleteMany({ where: { offerId: offer.id, userId: { notIn: tutors.map((t) => t.id) } } }),
      db.tutoringTutor.createMany({ data: tutors.map((t) => ({ offerId: offer.id, userId: t.id })), skipDuplicates: true }),
    ]);
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tutoring.offer_saved', entity: 'TutoringOffer', entityId: offer.id, after: { course: course.product.title, format, groupSize, classMinutes, classesTotal, weekdays, tutors: tutors.length } });
    refresh();
    return { ok: true, message: `${course.product.title} is ${active ? 'offered' : 'saved, not offered,'} with an online tutor. Running groups keep the terms they started on.` };
  } catch (err) {
    return fail(err);
  }
}

export async function saveEmployeeCodeAction(userId: string, code: string): Promise<ActionState> {
  try {
    const { tenant } = await office();
    const staff = await db.user.findFirst({ where: { id: userId, organizationId: tenant.organizationId, kind: 'STAFF' }, select: { id: true } });
    if (!staff) return { error: 'That person is not on the team.' };
    const employeeCode = code.trim().slice(0, 40) || null;
    await db.instructorProfile.upsert({ where: { userId }, create: { userId, employeeCode }, update: { employeeCode } });
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------ the office: learners */

export async function enrolTutoringAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await office();
    const offer = await db.tutoringOffer.findFirst({ where: { id: String(formData.get('offerId') ?? ''), organizationId: tenant.organizationId }, select: { id: true, courseId: true } });
    if (!offer) return { error: 'Choose a course.' };
    const who = String(formData.get('learner') ?? '').trim().toLowerCase();
    if (!who) return { error: "Type the learner's email address or phone number." };
    const person = await db.user.findFirst({
      where: { organizationId: tenant.organizationId, kind: 'LEARNER', deletedAt: null, OR: who.includes('@') ? [{ email: { equals: who, mode: 'insensitive' } }] : [{ phone: { in: phoneVariants(who) } }] },
      select: { id: true, name: true },
    });
    if (!person) return { error: `Nobody found for ${who}. Add the learner first, then enrol them here.` };
    const minute = minuteOf(formData.get('time'));
    if (minute == null) return { error: 'Choose the class time.' };
    const fromDay = String(formData.get('fromDay') ?? '');
    if (!isDay(fromDay)) return { error: 'Choose the day to start.' };
    const open = await db.tutoringSeat.count({ where: { organizationId: tenant.organizationId, offerId: offer.id, userId: person.id, status: { in: ['WAITING', 'PLACED'] } } });
    if (open) return { error: `${person.name} already has online classes for this course, or is waiting for a tutor.` };

    const seat = await db.tutoringSeat.create({
      data: { organizationId: tenant.organizationId, offerId: offer.id, userId: person.id, preferredMinute: minute, preferredFrom: fromDay, createdById: user.id, note: String(formData.get('note') ?? '').trim().slice(0, 300) },
      select: { id: true },
    });
    const tutorId = String(formData.get('tutorId') ?? '') || undefined;
    const placed = await placeSeat(tenant.organizationId, seat.id, { tutorId });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tutoring.enrolled', entity: 'TutoringSeat', entityId: seat.id, after: { learner: person.name, minute, fromDay, placed: placed.placed } });
    refresh();
    return placed.placed
      ? { ok: true, message: `${person.name} has a tutor and classes at ${timeLabel(minute)}. Both have been told.` }
      : { ok: true, message: `${person.name} is on the waiting list: ${placed.reason ?? 'no tutor is free then.'} They are placed as soon as one is, or you can pick a tutor or another time.` };
  } catch (err) {
    return fail(err);
  }
}

export async function placeSeatAction(seatId: string, tutorId?: string): Promise<ActionState> {
  try {
    const { tenant } = await office();
    const r = await placeSeat(tenant.organizationId, seatId, { tutorId: tutorId || undefined });
    refresh();
    return r.placed ? { ok: true, message: 'Placed. The learner and the tutor have been told.' } : { error: r.reason ?? 'No tutor is free then.' };
  } catch (err) {
    return fail(err);
  }
}

export async function changeSeatTimeAction(seatId: string, time: string): Promise<ActionState> {
  try {
    const { tenant } = await office();
    const minute = minuteOf(time);
    if (minute == null) return { error: 'Choose a time.' };
    const n = await db.tutoringSeat.updateMany({ where: { id: seatId, organizationId: tenant.organizationId, status: 'WAITING' }, data: { preferredMinute: minute } });
    if (!n.count) return { error: 'That learner is no longer waiting.' };
    const r = await placeSeat(tenant.organizationId, seatId);
    refresh();
    return r.placed ? { ok: true, message: `Placed at ${timeLabel(minute)}.` } : { ok: true, message: `Time changed to ${timeLabel(minute)}; still waiting: ${r.reason ?? 'no tutor is free then.'}` };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelSeatAction(seatId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await office('delete');
    const n = await db.tutoringSeat.updateMany({ where: { id: seatId, organizationId: tenant.organizationId, status: 'WAITING' }, data: { status: 'CANCELLED' } });
    if (!n.count) return { error: 'Only a learner still waiting can be taken off the list here.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tutoring.seat_cancelled', entity: 'TutoringSeat', entityId: seatId });
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------ groups: tutor and time */

export async function reassignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await office();
    const groupId = String(formData.get('groupId') ?? '');
    const tutorId = String(formData.get('tutorId') ?? '');
    const fromDay = String(formData.get('fromDay') ?? '') || dayKey(new Date(), tenant.timezone);
    if (!tutorId) return { error: 'Choose a tutor.' };
    if (!isDay(fromDay)) return { error: 'Choose the day the new tutor starts.' };
    await reassignGroup(tenant.organizationId, groupId, tutorId, fromDay);
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tutoring.reassigned', entity: 'TutoringGroup', entityId: groupId, after: { tutorId, fromDay } });
    refresh();
    return { ok: true, message: 'Handed over. The learners and the new tutor have been told.' };
  } catch (err) {
    return fail(err);
  }
}

/** The office, or the group's own tutor, moves the time: for one day, or from a day on. */
export async function changeSlotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user, isOffice } = await anyStaff();
    const r = await moveGroupTime(tenant, { id: user.id, isOffice }, {
      groupId: String(formData.get('groupId') ?? ''),
      time: formData.get('time'),
      fromDay: String(formData.get('fromDay') ?? ''),
      onlyThatDay: formData.get('scope') !== 'onwards',
    });
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, message: r.message };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------ a tutor's hours */

export async function addAvailabilityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user, isOffice } = await anyStaff();
    const r = await addHours(tenant, { id: user.id, isOffice }, {
      userId: String(formData.get('userId') ?? '') || undefined,
      weekdays: weekdaysFrom(formData),
      from: formData.get('from'),
      to: formData.get('to'),
    });
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, message: r.message };
  } catch (err) {
    return fail(err);
  }
}

export async function removeAvailabilityAction(id: string): Promise<ActionState> {
  try {
    const { tenant, user, isOffice } = await anyStaff();
    const r = await removeHours(tenant, { id: user.id, isOffice }, id);
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------ a tutor's leave */

export async function requestTutorLeaveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user, isOffice } = await anyStaff();
    const r = await requestLeave(tenant, { id: user.id, isOffice }, {
      userId: String(formData.get('userId') ?? '') || undefined,
      fromDay: String(formData.get('fromDay') ?? ''),
      toDay: String(formData.get('toDay') ?? ''),
      reason: String(formData.get('reason') ?? ''),
    });
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, message: r.message };
  } catch (err) {
    return fail(err);
  }
}

export async function decideTutorLeaveAction(leaveId: string, approve: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await office();
    const claimed = await db.tutorLeave.updateMany({
      where: { id: leaveId, organizationId: tenant.organizationId, status: 'PENDING' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: user.id, decidedAt: new Date() },
    });
    if (!claimed.count) return { error: 'That request has already been decided.' };
    const leave = await db.tutorLeave.findFirst({ where: { id: leaveId, organizationId: tenant.organizationId }, select: { userId: true, fromDay: true, toDay: true } });
    let message = 'Refused. Nothing changes for the learners.';
    if (approve) {
      const outcome = await applyTutorLeave(tenant.organizationId, leaveId);
      message = outcome
        ? outcome.plan === 'CANCEL'
          ? `Approved. ${outcome.classesMoved} ${outcome.classesMoved === 1 ? 'class' : 'classes'} moved to the end; the learners have been told.`
          : `Approved. ${outcome.handedOver.length} ${outcome.handedOver.length === 1 ? 'group' : 'groups'} handed to another tutor${outcome.needsTutor.length ? `; ${outcome.needsTutor.length} could not be and ${outcome.needsTutor.length === 1 ? 'needs' : 'need'} a tutor or a new time` : ''}.`
        : 'Approved.';
    }
    if (leave) {
      await tell({
        organizationId: tenant.organizationId,
        eventKey: 'tutoring.leave_decided',
        userIds: [leave.userId],
        subject: approve ? 'Your leave is approved' : 'Your leave was not approved',
        body: approve
          ? `Hello {{name}}, your leave from ${leave.fromDay} to ${leave.toDay} is approved. Your online learners have been told.`
          : `Hello {{name}}, your leave from ${leave.fromDay} to ${leave.toDay} was not approved. Please speak to the office.`,
        dedupe: `leave:${leaveId}:${approve ? 'yes' : 'no'}`,
      });
    }
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: approve ? 'tutoring.leave_approved' : 'tutoring.leave_refused', entity: 'TutorLeave', entityId: leaveId });
    refresh();
    return { ok: true, message };
  } catch (err) {
    return fail(err);
  }
}

export async function withdrawTutorLeaveAction(leaveId: string): Promise<ActionState> {
  try {
    const { tenant, user, isOffice } = await anyStaff();
    const r = await withdrawLeave(tenant, { id: user.id, isOffice }, leaveId);
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------ the learner */

export async function chooseSlotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await learner();
    const r = await chooseSlot(tenant, user.id, { offerId: String(formData.get('offerId') ?? ''), time: formData.get('time'), fromDay: String(formData.get('fromDay') ?? '') });
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, message: r.message };
  } catch (err) {
    return fail(err);
  }
}

export async function learnerLeaveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await learner();
    const r = await takeLeave(tenant, user.id, {
      seatId: String(formData.get('seatId') ?? ''),
      fromDay: String(formData.get('fromDay') ?? ''),
      toDay: String(formData.get('toDay') ?? ''),
      reason: String(formData.get('reason') ?? ''),
    });
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, message: r.message };
  } catch (err) {
    return fail(err);
  }
}

/** The learner on the tutor: an overall rating, three short questions, and a few words. */
export async function learnerFeedbackAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await learner();
    const r = await sendFeedback(tenant, user.id, {
      feedbackId: String(formData.get('feedbackId') ?? ''),
      rating: formData.get('rating'),
      clear: formData.get('clear'),
      punctual: formData.get('punctual'),
      pace: formData.get('pace'),
      comment: String(formData.get('comment') ?? ''),
    });
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, message: r.message };
  } catch (err) {
    return fail(err);
  }
}

/** The tutor on the learner: a progress note the learner and the office see. */
export async function tutorFeedbackAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await anyStaff();
    const r = await sendProgressNote(tenant, user.id, {
      feedbackId: String(formData.get('feedbackId') ?? ''),
      rating: formData.get('rating'),
      attendance: formData.get('attendance'),
      participation: formData.get('participation'),
      homework: formData.get('homework'),
      comment: String(formData.get('comment') ?? ''),
    });
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, message: r.message };
  } catch (err) {
    return fail(err);
  }
}
