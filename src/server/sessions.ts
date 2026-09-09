'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff, getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import type { ActionState } from '@/server/courses';

/** Sign-in is "in time" if it lands within this many minutes of the start. */
const IN_TIME_GRACE_MINUTES = 10;

async function guard(permission = 'scheduling.sessions', action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[sessions]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const schedule = z.object({
  batchId: z.string().min(1, 'Choose a batch'),
  title: z.string().trim().min(2, 'Give the class a name').max(160),
  topics: z.string().trim().max(500).optional(),
  startDate: z.string().min(1, 'Pick a start date'),
  startTime: z.string().min(1, 'Pick a start time'),
  durationMinutes: z.coerce.number().int().min(5).max(600),
  joinUrl: z.string().trim().url('Join link must be a full URL').optional().or(z.literal('')),
  repeatWeeks: z.coerce.number().int().min(0).max(52),
  days: z.array(z.string()).optional(),
});

/**
 * Creates one class or a weekly series. Medcity runs fixed weekly group classes,
 * so the common case is "these weekdays, this time, for N weeks", not a one-off.
 */
export async function scheduleSessions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const parsed = schedule.safeParse({
      batchId: formData.get('batchId'),
      title: formData.get('title'),
      topics: formData.get('topics') || undefined,
      startDate: formData.get('startDate'),
      startTime: formData.get('startTime'),
      durationMinutes: formData.get('durationMinutes'),
      joinUrl: formData.get('joinUrl') || '',
      repeatWeeks: formData.get('repeatWeeks') || 0,
      days: formData.getAll('days').map(String),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const batch = await db.batch.findFirst({
      where: { id: d.batchId, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!batch) return { error: 'Batch not found.' };

    const first = new Date(`${d.startDate}T${d.startTime}:00`);
    if (Number.isNaN(first.getTime())) return { error: 'That date and time did not parse.' };

    const selectedDays = (d.days ?? []).filter((x) => WEEKDAYS.includes(x as never));
    const occurrences: Date[] = [];

    if (d.repeatWeeks === 0 || selectedDays.length === 0) {
      occurrences.push(first);
    } else {
      const dayNumbers = selectedDays.map((x) => WEEKDAYS.indexOf(x as (typeof WEEKDAYS)[number]));
      const weekStart = new Date(first);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());

      for (let week = 0; week < d.repeatWeeks; week++) {
        for (const dow of dayNumbers) {
          const occ = new Date(weekStart);
          occ.setDate(weekStart.getDate() + week * 7 + dow);
          occ.setHours(first.getHours(), first.getMinutes(), 0, 0);
          if (occ >= first) occurrences.push(occ);
        }
      }
    }

    if (occurrences.length === 0) return { error: 'That produced no classes. Check the dates.' };
    if (occurrences.length > 200) return { error: 'That is more than 200 classes. Narrow the range.' };

    const recurrence =
      occurrences.length > 1
        ? await db.sessionRecurrence.create({
            data: {
              rrule: `FREQ=WEEKLY;BYDAY=${selectedDays.join(',')};COUNT=${occurrences.length}`,
              untilDate: occurrences[occurrences.length - 1],
            },
            select: { id: true },
          })
        : null;

    await db.liveSession.createMany({
      data: occurrences.map((startsAt) => ({
        organizationId: tenant.organizationId,
        batchId: d.batchId,
        title: d.title,
        topics: d.topics || null,
        startsAt,
        endsAt: new Date(startsAt.getTime() + d.durationMinutes * 60_000),
        joinUrl: d.joinUrl || null,
        recurrenceId: recurrence?.id,
        status: 'SCHEDULED',
      })),
    });

    revalidatePath('/admin/sessions');
    revalidatePath('/learn');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelSession(sessionId: string, reason?: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const session = await db.liveSession.findFirst({
      where: { id: sessionId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!session) return { error: 'Class not found.' };

    await db.liveSession.update({
      where: { id: sessionId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null },
    });

    revalidatePath('/admin/sessions');
    revalidatePath('/learn');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Attendance without anyone remembering to take it: joining records it, and the
 * in-time flag comes from the clock rather than a trainer's judgement.
 */
export async function joinSession(sessionId: string): Promise<ActionState & { url?: string }> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { error: 'SIGN_IN_REQUIRED' };

    const session = await db.liveSession.findFirst({
      where: {
        id: sessionId,
        organizationId: tenant.organizationId,
        status: { not: 'CANCELLED' },
      },
      select: { id: true, startsAt: true, joinUrl: true, batchId: true },
    });
    if (!session) return { error: 'That class is not available.' };

    const enrolled = await db.enrollment.findFirst({
      where: { userId: user.id, batchId: session.batchId, status: { in: ['ENROLLED', 'COMPLETED'] } },
      select: { id: true },
    });
    if (!enrolled && user.kind !== 'STAFF') return { error: 'You are not in this batch.' };

    const now = new Date();
    const minutesLate = Math.round((now.getTime() - session.startsAt.getTime()) / 60_000);

    if (user.kind === 'LEARNER') {
      await db.attendance.upsert({
        where: { sessionId_userId: { sessionId, userId: user.id } },
        create: {
          sessionId,
          userId: user.id,
          status: minutesLate > IN_TIME_GRACE_MINUTES ? 'LATE' : 'PRESENT',
          joinedAt: now,
          wasInTime: minutesLate <= IN_TIME_GRACE_MINUTES,
        },
        update: { joinedAt: now },
      });
    }

    revalidatePath('/learn');
    return { ok: true, url: session.joinUrl ?? undefined };
  } catch (err) {
    return fail(err);
  }
}

/** Staff override, for the phone-call cases attendance automation cannot see. */
export async function markAttendance(
  sessionId: string,
  userId: string,
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED',
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('batches.batch_learners');

    const session = await db.liveSession.findFirst({
      where: { id: sessionId, organizationId: tenant.organizationId },
      select: { id: true, startsAt: true },
    });
    if (!session) return { error: 'Class not found.' };

    await db.attendance.upsert({
      where: { sessionId_userId: { sessionId, userId } },
      create: {
        sessionId,
        userId,
        status,
        markedById: user.id,
        wasInTime: status === 'PRESENT',
      },
      update: { status, markedById: user.id, wasInTime: status === 'PRESENT' },
    });

    revalidatePath(`/admin/sessions/${sessionId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
