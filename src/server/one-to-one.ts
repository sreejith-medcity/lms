'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser, requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { provisionMeetings, releaseMeeting } from '@/lib/zoom-sessions';
import { bookableSlots, creditsLeft, slotStillFree, type Slot } from '@/lib/booking-slots';
import type { ActionState } from '@/server/courses';

/**
 * One-to-one classes: a class that belongs to a learner rather than a batch.
 *
 * The academy already teaches these and currently has to invent a batch of
 * one for each of them, which pollutes every batch list, every report and
 * every roster. A session without a batch is the honest shape, and the
 * booking side of it is the part that has to be right: a trainer describes
 * their week once, the bookable times are worked out from it, and the slot
 * is checked again at the moment of booking because two people can be
 * looking at the same one.
 */

async function staffGuard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('scheduling.sessions', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[one to one]', message);
  return { error: 'Something went wrong. Please try again.' };
}

function minutesFrom(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

/* A trainer's week ---------------------------------------------------------- */

export async function saveAvailability(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await staffGuard();

    const trainerId = String(formData.get('userId') ?? '');
    const weekday = Number(formData.get('weekday') ?? -1);
    const start = minutesFrom(formData.get('start'));
    const end = minutesFrom(formData.get('end'));
    const slotMinutes = Math.max(15, Math.min(180, Number(formData.get('slotMinutes') ?? 30) || 30));

    if (!trainerId) return { error: 'Pick a trainer.' };
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: 'Pick a day.' };
    if (start == null || end == null) return { error: 'Give the times as 18:00 and 21:00.' };
    if (end - start < slotMinutes) {
      return { error: `That window is shorter than one ${slotMinutes} minute slot.` };
    }

    const trainer = await db.user.findFirst({
      where: { id: trainerId, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!trainer) return { error: 'That trainer was not found.' };

    await db.mentorAvailability.create({
      data: {
        organizationId: tenant.organizationId,
        userId: trainerId,
        weekday,
        startMinute: start,
        endMinute: end,
        slotMinutes,
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'one_to_one.availability_added',
      entity: 'User',
      entityId: trainerId,
      after: { weekday, start, end, slotMinutes },
    });

    revalidatePath('/admin/one-to-one');
    return { ok: true, message: `${trainer.name} is now bookable then.` };
  } catch (err) {
    return fail(err);
  }
}

export async function removeAvailability(id: string): Promise<ActionState> {
  try {
    const { tenant } = await staffGuard('delete');
    await db.mentorAvailability.deleteMany({ where: { id, organizationId: tenant.organizationId } });
    revalidatePath('/admin/one-to-one');
    return { ok: true, message: 'Removed. Classes already booked are untouched.' };
  } catch (err) {
    return fail(err);
  }
}

export async function addBlackout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant } = await staffGuard();

    const trainerId = String(formData.get('userId') ?? '');
    const from = new Date(String(formData.get('from') ?? ''));
    const to = new Date(String(formData.get('to') ?? ''));
    const reason = String(formData.get('reason') ?? '').trim();

    if (!trainerId) return { error: 'Pick a trainer.' };
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return { error: 'Give both dates.' };
    }
    if (to <= from) return { error: 'The end has to be after the start.' };

    await db.mentorBlackout.create({
      data: {
        organizationId: tenant.organizationId,
        userId: trainerId,
        startsAt: from,
        endsAt: to,
        reason: reason || null,
      },
    });

    revalidatePath('/admin/one-to-one');
    return { ok: true, message: 'Marked as away. Those hours stop being offered.' };
  } catch (err) {
    return fail(err);
  }
}

export async function removeBlackout(id: string): Promise<ActionState> {
  try {
    const { tenant } = await staffGuard('delete');
    await db.mentorBlackout.deleteMany({ where: { id, organizationId: tenant.organizationId } });
    revalidatePath('/admin/one-to-one');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Credits ------------------------------------------------------------------- */

export async function grantCredits(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await staffGuard();

    const userId = String(formData.get('userId') ?? '');
    const sessions = Math.max(1, Math.min(100, Number(formData.get('sessions') ?? 1) || 1));
    const minutes = Math.max(15, Math.min(240, Number(formData.get('minutes') ?? 30) || 30));
    const note = String(formData.get('note') ?? '').trim();
    const expiresRaw = String(formData.get('expiresAt') ?? '').trim();
    const expiresAt = expiresRaw ? new Date(expiresRaw) : null;

    if (!userId) return { error: 'Pick a learner.' };
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return { error: 'That expiry is not a date.' };

    const learner = await db.user.findFirst({
      where: { id: userId, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!learner) return { error: 'That learner was not found.' };

    await db.oneToOneCredit.create({
      data: {
        organizationId: tenant.organizationId,
        userId,
        sessionsTotal: sessions,
        minutesPerSession: minutes,
        expiresAt,
        note: note || null,
        grantedById: user.id,
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'one_to_one.credits_granted',
      entity: 'User',
      entityId: userId,
      after: { sessions, minutes, expiresAt },
    });

    revalidatePath('/admin/one-to-one');
    revalidatePath(`/admin/learners/${userId}`);
    return {
      ok: true,
      message: `${learner.name} has ${sessions} session${sessions === 1 ? '' : 's'} of ${minutes} minutes.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/* Booking ------------------------------------------------------------------- */

export interface SlotOffer {
  startsAt: string;
  endsAt: string;
  label: string;
}

/** What a trainer's diary has left, for the booking screen. */
export async function offeredSlots(input: {
  trainerId: string;
  durationMinutes: number;
  days?: number;
}): Promise<SlotOffer[]> {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return [];

  const from = new Date();
  const to = new Date(Date.now() + Math.max(1, Math.min(120, input.days ?? 30)) * 86_400_000);

  const [availability, blackouts, busy] = await Promise.all([
    db.mentorAvailability.findMany({
      where: { organizationId: tenant.organizationId, userId: input.trainerId, isActive: true },
      select: {
        weekday: true,
        startMinute: true,
        endMinute: true,
        slotMinutes: true,
        validFrom: true,
        validUntil: true,
      },
    }),
    db.mentorBlackout.findMany({
      where: {
        organizationId: tenant.organizationId,
        userId: input.trainerId,
        endsAt: { gte: from },
      },
      select: { startsAt: true, endsAt: true },
    }),
    db.liveSession.findMany({
      where: {
        organizationId: tenant.organizationId,
        cancelledAt: null,
        startsAt: { gte: from, lte: to },
        OR: [
          { instructors: { some: { userId: input.trainerId } } },
          { batch: { staff: { some: { userId: input.trainerId } } } },
        ],
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  const slots = bookableSlots({
    availability,
    blackouts,
    busy,
    durationMinutes: input.durationMinutes,
    timeZone: tenant.timezone,
    from,
    to,
    minNoticeHours: 12,
    limit: 120,
  });

  const format = new Intl.DateTimeFormat('en-IN', {
    timeZone: tenant.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return slots.map((slot) => ({
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    label: format.format(slot.startsAt),
  }));
}

/**
 * Book one class.
 *
 * Called by a learner spending a credit, and by the office booking on their
 * behalf. The same checks run either way: the slot has to be inside the
 * trainer's week, free, far enough ahead, and paid for by a credit with
 * something left on it.
 */
export async function bookOneToOne(input: {
  learnerId?: string;
  trainerId: string;
  startsAt: string;
  creditId?: string;
  title?: string;
}): Promise<ActionState & { sessionId?: string }> {
  try {
    const tenant = await requireTenant();
    const me = await getSessionUser();
    if (!me) return { error: 'Please sign in again.' };

    const bookingForSomeoneElse = Boolean(input.learnerId && input.learnerId !== me.id);
    if (bookingForSomeoneElse) await requireStaff('scheduling.sessions', 'edit');

    const learnerId = input.learnerId ?? me.id;

    const [learner, trainer] = await Promise.all([
      db.user.findFirst({
        where: { id: learnerId, organizationId: tenant.organizationId, deletedAt: null },
        select: { id: true, name: true },
      }),
      db.user.findFirst({
        where: { id: input.trainerId, organizationId: tenant.organizationId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);
    if (!learner) return { error: 'That learner was not found.' };
    if (!trainer) return { error: 'That trainer was not found.' };

    // The credit decides the length, so a thirty minute purchase cannot be
    // spent on an hour.
    const credits = await db.oneToOneCredit.findMany({
      where: {
        organizationId: tenant.organizationId,
        userId: learnerId,
        ...(input.creditId ? { id: input.creditId } : {}),
      },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        sessionsTotal: true,
        minutesPerSession: true,
        expiresAt: true,
        _count: { select: { sessions: { where: { cancelledAt: null } } } },
      },
    });

    const usable = credits.find((c) => {
      const state = creditsLeft({
        sessionsTotal: c.sessionsTotal,
        bookedCount: c._count.sessions,
        expiresAt: c.expiresAt,
      });
      return state.left > 0 && !state.expired;
    });

    if (!usable) {
      return {
        error: bookingForSomeoneElse
          ? 'That learner has no one-to-one sessions left. Give them some first.'
          : 'You have no one-to-one sessions left.',
      };
    }

    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) return { error: 'That is not a time.' };
    const endsAt = new Date(startsAt.getTime() + usable.minutesPerSession * 60_000);
    const slot: Slot = { startsAt, endsAt };

    const [availability, blackouts, busy] = await Promise.all([
      db.mentorAvailability.findMany({
        where: { organizationId: tenant.organizationId, userId: trainer.id, isActive: true },
        select: {
          weekday: true,
          startMinute: true,
          endMinute: true,
          slotMinutes: true,
          validFrom: true,
          validUntil: true,
        },
      }),
      db.mentorBlackout.findMany({
        where: { organizationId: tenant.organizationId, userId: trainer.id, endsAt: { gte: new Date() } },
        select: { startsAt: true, endsAt: true },
      }),
      db.liveSession.findMany({
        where: {
          organizationId: tenant.organizationId,
          cancelledAt: null,
          startsAt: { gte: new Date(startsAt.getTime() - 12 * 3_600_000) },
          endsAt: { lte: new Date(startsAt.getTime() + 12 * 3_600_000) },
          OR: [
            { instructors: { some: { userId: trainer.id } } },
            { batch: { staff: { some: { userId: trainer.id } } } },
          ],
        },
        select: { startsAt: true, endsAt: true },
      }),
    ]);

    // Asked again here, not only when the list was drawn: two learners can be
    // looking at the same slot, and the office books into the same diary.
    const free = slotStillFree({
      slot,
      availability,
      blackouts,
      busy,
      timeZone: tenant.timezone,
      // The office may book at short notice; a learner may not.
      minNoticeHours: bookingForSomeoneElse ? 0 : 12,
    });

    if (!free.ok) {
      const why = {
        TAKEN: 'Somebody has just taken that time. Pick another.',
        AWAY: 'The trainer is away then.',
        TOO_SOON: 'That is too soon. Please pick a time at least twelve hours ahead.',
        OUTSIDE_HOURS: 'That is outside the hours this trainer takes classes.',
      } as const;
      return { error: why[free.reason ?? 'TAKEN'] };
    }

    const session = await db.liveSession.create({
      data: {
        organizationId: tenant.organizationId,
        batchId: null,
        learnerId: learner.id,
        creditId: usable.id,
        title: input.title?.trim() || `One to one with ${trainer.name}`,
        startsAt,
        endsAt,
        status: 'SCHEDULED',
        provider: 'ZOOM',
        instructors: { create: { userId: trainer.id, isPrimary: true } },
      },
      select: { id: true },
    });

    // One meeting, now, because a one-to-one booked for tomorrow evening with
    // no join link is a class nobody can attend.
    const provisioned = await provisionMeetings(tenant.organizationId, {
      sessionIds: [session.id],
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: me.id,
      action: 'one_to_one.booked',
      entity: 'LiveSession',
      entityId: session.id,
      after: { learnerId: learner.id, trainerId: trainer.id, startsAt },
    });

    revalidatePath('/admin/one-to-one');
    revalidatePath('/learn');

    return {
      ok: true,
      sessionId: session.id,
      message:
        provisioned.created > 0
          ? 'Booked, and the join link is ready.'
          : `Booked.${provisioned.reason ? ` ${provisioned.reason}` : ''}`,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Cancelling returns the credit, because the credit is counted from the
 * classes booked against it rather than stored as a number to adjust.
 */
export async function cancelOneToOne(sessionId: string, reason?: string): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const me = await getSessionUser();
    if (!me) return { error: 'Please sign in again.' };

    const session = await db.liveSession.findFirst({
      where: { id: sessionId, organizationId: tenant.organizationId, learnerId: { not: null } },
      select: { id: true, learnerId: true, startsAt: true, cancelledAt: true },
    });
    if (!session) return { error: 'That class was not found.' };
    if (session.cancelledAt) return { ok: true, message: 'Already called off.' };

    if (session.learnerId !== me.id) await requireStaff('scheduling.sessions', 'edit');

    // A learner cancelling an hour beforehand is a trainer sitting in an
    // empty room, so the same notice applies to calling it off as to booking.
    if (session.learnerId === me.id && session.startsAt.getTime() - Date.now() < 12 * 3_600_000) {
      return {
        error: 'This class is within twelve hours. Please call the academy rather than cancelling here.',
      };
    }

    await db.liveSession.update({
      where: { id: session.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason?.trim() || null,
      },
    });

    await releaseMeeting(tenant.organizationId, session.id).catch(() => undefined);

    revalidatePath('/admin/one-to-one');
    revalidatePath('/learn');
    return { ok: true, message: 'Called off, and the session goes back to their balance.' };
  } catch (err) {
    return fail(err);
  }
}
