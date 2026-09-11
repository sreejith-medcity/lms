'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff, getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import type { ActionState } from '@/server/courses';
import { recordAudit } from '@/lib/audit';
import { dayStart, dayEnd } from '@/lib/clock';
import { queueNotifications, describeQueue } from '@/lib/notify';
import { provisionMeetings, releaseMeeting } from '@/lib/zoom-sessions';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';

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

    // A handful of classes get their Zoom meetings now, because waiting for the
    // next scheduled run to see a join link would be baffling. A whole term does
    // not: fifty Zoom calls inside one form submission is a request that times
    // out with half the term provisioned. Those are picked up a fortnight out.
    let zoomNote = '';
    if (!d.joinUrl) {
      const provisioned = await provisionMeetings(tenant.organizationId, {
        limit: occurrences.length <= 8 ? occurrences.length : 4,
      });

      if (provisioned.created > 0) {
        zoomNote =
          provisioned.created === occurrences.length
            ? ' Zoom meetings created.'
            : ` Zoom meetings created for the first ${provisioned.created}; the rest are made a fortnight before each class.`;
      } else if (provisioned.reason) {
        zoomNote = ` ${provisioned.reason}`;
      }
    }

    revalidatePath('/admin/sessions');
    revalidatePath('/learn');
    return {
      ok: true,
      message: `${occurrences.length} ${occurrences.length === 1 ? 'class' : 'classes'} scheduled.${zoomNote}`,
    };
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

    // The room goes with the class. A learner who kept the old email should find
    // nothing rather than sit alone in a meeting that still opens.
    await releaseMeeting(tenant.organizationId, sessionId);

    const queued = await tellTheRoll(tenant.organizationId, sessionId, 'session.cancelled', {
      reason: reason?.trim() || 'Your trainer will confirm the new date.',
    });

    revalidatePath('/admin/sessions');
    revalidatePath('/learn');
    return { ok: true, message: queued };
  } catch (err) {
    return fail(err);
  }
}

/**
 * A Zoom meeting for one class, now. For a class scheduled before Zoom was
 * connected, or one whose first attempt failed, so nobody has to wait for
 * the scheduled run or guess why there is no link.
 */
export async function createMeetingNow(sessionId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const session = await db.liveSession.findFirst({
      where: { id: sessionId, organizationId: tenant.organizationId },
      select: { id: true, providerMeetingId: true, status: true, startsAt: true, endsAt: true },
    });
    if (!session) return { error: 'Class not found.' };
    if (session.providerMeetingId) return { ok: true, message: 'This class already has its meeting.' };
    if (session.status === 'CANCELLED') return { error: 'This class was cancelled.' };
    if (session.endsAt < new Date()) return { error: 'This class has already finished.' };

    const result = await provisionMeetings(tenant.organizationId, { sessionIds: [session.id] });

    revalidatePath(`/admin/sessions/${session.id}`);
    revalidatePath('/admin/sessions');
    revalidatePath('/learn');

    if (result.created > 0) return { ok: true, message: 'Zoom meeting created.' };
    if (result.reason) return { error: `Zoom refused: ${result.reason}` };
    return {
      error:
        'Nothing was created. The class may already be in the past, or Zoom is not connected for this academy.',
    };
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
      where: {
        organizationId: tenant.organizationId,
        userId: user.id,
        batchId: session.batchId,
        status: { in: ['ENROLLED', 'COMPLETED'] },
      },
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

/**
 * Attaches an uploaded file to a class as its recording. Edmingle holds 1,089 of
 * these behind a player that will not seek; here they are ordinary library assets,
 * so the same file can also be dropped into a course as catch-up material.
 */
export async function attachRecording(
  sessionId: string,
  assetId: string,
  title?: string,
): Promise<ActionState> {
  try {
    const { tenant } = await guard('class_recording.publish_recordings', 'edit');

    const [session, asset] = await Promise.all([
      db.liveSession.findFirst({
        where: { id: sessionId, organizationId: tenant.organizationId },
        select: { id: true, title: true },
      }),
      db.asset.findFirst({
        where: {
          id: assetId,
          organizationId: tenant.organizationId,
          deletedAt: null,
          transcodeStatus: { not: 'UPLOADING' },
        },
        select: { id: true, name: true, type: true },
      }),
    ]);

    if (!session) return { error: 'Class not found.' };
    if (!asset) return { error: 'That file is still uploading, or is no longer available.' };
    if (asset.type !== 'VIDEO' && asset.type !== 'AUDIO') {
      return { error: 'A recording has to be a video or an audio file.' };
    }

    await db.recording.create({
      data: {
        sessionId: session.id,
        assetId: asset.id,
        title: (title?.trim() || asset.name || session.title).slice(0, 160),
      },
    });

    await db.asset.update({ where: { id: asset.id }, data: { usageCount: { increment: 1 } } });

    revalidatePath(`/admin/sessions/${sessionId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function removeRecording(recordingId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('class_recording.publish_recordings', 'delete');

    const recording = await db.recording.findFirst({
      where: { id: recordingId, session: { organizationId: tenant.organizationId } },
      select: { id: true, sessionId: true, assetId: true },
    });
    if (!recording) return { error: 'Recording not found.' };

    await db.recording.delete({ where: { id: recording.id } });
    await db.asset.update({
      where: { id: recording.assetId },
      data: { usageCount: { decrement: 1 } },
    });

    revalidatePath(`/admin/sessions/${recording.sessionId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Holidays ------------------------------------------------------------------ */

const holiday = z.object({
  fromDate: z.string().min(1, 'Pick a date'),
  toDate: z.string().optional(),
  batchId: z.string().optional(),
  reason: z.string().trim().max(120).optional(),
});

/**
 * Mark a day off.
 *
 * A holiday is not the same as a cancelled class even though both mean nobody
 * turns up: attendance percentages have to ignore it, and a learner reading
 * "cancelled" on Onam wonders what went wrong. So the classes are cancelled with
 * a flag that says why, and the flag is what the reports read.
 */
export async function markHoliday(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('scheduling.mark_holiday');

    const parsed = holiday.safeParse({
      fromDate: formData.get('fromDate'),
      toDate: formData.get('toDate') || undefined,
      batchId: formData.get('batchId') || undefined,
      reason: formData.get('reason') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const from = dayStart(d.fromDate, tenant.timezone);
    const to = dayEnd(d.toDate && d.toDate >= d.fromDate ? d.toDate : d.fromDate, tenant.timezone);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return { error: 'That date did not parse.' };
    }

    const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    if (spanDays > 60) return { error: 'That is more than sixty days. Mark it in shorter runs.' };

    const where = {
      organizationId: tenant.organizationId,
      startsAt: { gte: from, lt: to },
      status: { not: 'CANCELLED' as const },
      ...(d.batchId ? { batchId: d.batchId } : {}),
    };

    const affected = await db.liveSession.count({ where });
    if (affected === 0) {
      return { error: 'No classes were scheduled then, so there is nothing to mark.' };
    }

    await db.liveSession.updateMany({
      where,
      data: {
        status: 'CANCELLED',
        isHoliday: true,
        cancelledAt: new Date(),
        cancelReason: d.reason?.trim() || 'Holiday',
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'session.holiday.marked',
      entity: 'LiveSession',
      entityId: d.batchId ?? 'all',
      after: { from: d.fromDate, to: d.toDate ?? d.fromDate, affected, reason: d.reason ?? 'Holiday' },
    });

    revalidatePath('/admin/calendar');
    revalidatePath('/admin/sessions');
    revalidatePath('/learn');
    return {
      ok: true,
      message: `${affected} ${affected === 1 ? 'class is' : 'classes are'} now marked as a holiday.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/** Puts a wrongly marked holiday back on the timetable. */
export async function clearHoliday(
  fromDate: string,
  toDate: string | null,
  batchId: string | null,
): Promise<ActionState> {
  try {
    const { tenant } = await guard('scheduling.mark_holiday');

    const from = dayStart(fromDate, tenant.timezone);
    const to = dayEnd(toDate && toDate >= fromDate ? toDate : fromDate, tenant.timezone);

    const restored = await db.liveSession.updateMany({
      where: {
        organizationId: tenant.organizationId,
        startsAt: { gte: from, lt: to },
        isHoliday: true,
        ...(batchId ? { batchId } : {}),
      },
      data: { status: 'SCHEDULED', isHoliday: false, cancelledAt: null, cancelReason: null },
    });

    revalidatePath('/admin/calendar');
    revalidatePath('/admin/sessions');
    revalidatePath('/learn');
    return {
      ok: true,
      message:
        restored.count === 0
          ? 'Nothing was marked as a holiday then.'
          : `${restored.count} ${restored.count === 1 ? 'class is' : 'classes are'} back on.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Publish or unpublish recordings in one go.
 *
 * A term's worth of classes gets recorded before anyone decides which of them
 * learners should see, and doing that one session page at a time is why the
 * incumbent's library sits half-published.
 */
export async function setRecordingsPublished(
  recordingIds: string[],
  isPublished: boolean,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('class_recording.publish_recordings');

    const ids = recordingIds.filter(Boolean).slice(0, 200);
    if (ids.length === 0) return { error: 'Nothing was selected.' };

    const owned = await db.recording.findMany({
      where: { id: { in: ids }, session: { organizationId: tenant.organizationId } },
      select: { id: true },
    });
    if (owned.length === 0) return { error: 'Those recordings are no longer available.' };

    await db.recording.updateMany({
      where: { id: { in: owned.map((r) => r.id) } },
      data: { isPublished },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: isPublished ? 'recording.published' : 'recording.unpublished',
      entity: 'Recording',
      entityId: owned.length === 1 ? owned[0].id : 'bulk',
      after: { count: owned.length },
    });

    revalidatePath('/admin/recordings');
    revalidatePath('/learn');
    return {
      ok: true,
      message: `${owned.length} ${owned.length === 1 ? 'recording' : 'recordings'} ${
        isPublished ? 'published' : 'hidden'
      }.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function renameRecording(recordingId: string, title: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('class_recording.publish_recordings');

    const trimmed = title.trim();
    if (trimmed.length < 2) return { error: 'Give the recording a title.' };

    const recording = await db.recording.findFirst({
      where: { id: recordingId, session: { organizationId: tenant.organizationId } },
      select: { id: true },
    });
    if (!recording) return { error: 'Recording not found.' };

    await db.recording.update({ where: { id: recording.id }, data: { title: trimmed.slice(0, 160) } });

    revalidatePath('/admin/recordings');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Telling people ------------------------------------------------------------ */

async function rosterOf(sessionId: string, organizationId: string) {
  return db.liveSession.findFirst({
    where: { id: sessionId, organizationId },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      learner: { select: { id: true, email: true, phone: true } },
      batch: {
        select: {
          id: true,
          name: true,
          enrollments: {
            where: { status: { in: ['ENROLLED', 'REGISTERED'] } },
            select: { user: { select: { id: true, email: true, phone: true } } },
          },
        },
      },
      attendances: { select: { userId: true, status: true } },
    },
  });
}

/**
 * Who is in a class, whether it is a batch or a one-to-one.
 *
 * Every message about a class asks the same question, and asking it in one
 * place is what stops a one-to-one being the class where the reminder,
 * the absentee note or the cancellation quietly goes to nobody.
 */
type RosterSession = NonNullable<Awaited<ReturnType<typeof rosterOf>>>;

function peopleIn(session: RosterSession): { id: string; email: string | null; phone: string | null }[] {
  if (session.batch) return session.batch.enrollments.map((e) => e.user);
  return session.learner ? [session.learner] : [];
}

/**
 * Tell the people who did not turn up.
 *
 * Only after the class has finished, and only to those with no sign-in against
 * it, because a note about missing a class you attended is worse than no note.
 */
export async function notifyAbsentees(sessionId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('scheduling.sessions');

    const session = await rosterOf(sessionId, tenant.organizationId);
    if (!session) return { error: 'Class not found.' };
    if (session.status === 'CANCELLED') return { error: 'That class was called off.' };
    if (session.endsAt > new Date()) {
      return { error: 'That class has not finished yet, so nobody is absent from it.' };
    }

    const came = new Set(
      session.attendances
        .filter((a) => a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'EXCUSED')
        .map((a) => a.userId),
    );

    const absentees = peopleIn(session)
      .filter((u) => !came.has(u.id))
      .map((u) => ({ userId: u.id, email: u.email, phone: u.phone }));

    if (absentees.length === 0) return { ok: true, message: 'Everybody turned up. Nothing to send.' };

    const result = await queueNotifications({
      organizationId: tenant.organizationId,
      eventKey: 'session.absent',
      recipients: absentees,
      dedupeKey: `session:${session.id}`,
    });

    revalidatePath(`/admin/sessions/${sessionId}`);
    return { ok: true, message: describeQueue(result, 'note') };
  } catch (err) {
    return fail(err);
  }
}

/** A nudge before a class, sent by hand rather than waiting for the scheduler. */
export async function remindRoster(sessionId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('scheduling.sessions');

    const session = await rosterOf(sessionId, tenant.organizationId);
    if (!session) return { error: 'Class not found.' };
    if (session.status === 'CANCELLED') return { error: 'That class was called off.' };
    if (session.startsAt < new Date()) {
      return { error: 'That class has already started. A reminder now would only confuse people.' };
    }

    const roster = peopleIn(session).map((u) => ({
      userId: u.id,
      email: u.email,
      phone: u.phone,
    }));
    if (roster.length === 0) return { error: 'Nobody is enrolled in this class yet.' };

    const result = await queueNotifications({
      organizationId: tenant.organizationId,
      eventKey: 'session.reminder',
      recipients: roster,
      dedupeKey: `session:${session.id}`,
    });

    revalidatePath(`/admin/sessions/${sessionId}`);
    return { ok: true, message: describeQueue(result, 'reminder') };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Telling everyone on the roll about a class.
 *
 * Context is written onto each queued row rather than looked up when it is sent,
 * so a cancellation still names the right class after somebody renames it, and
 * still says the right time after the calendar is rearranged around it.
 */
async function tellTheRoll(
  organizationId: string,
  sessionId: string,
  eventKey: string,
  extra: Record<string, string> = {},
): Promise<string> {
  const session = await rosterOf(sessionId, organizationId);
  if (!session) return '';

  const people = peopleIn(session);
  if (!people.length) return 'Nobody is enrolled, so there was nobody to tell.';

  const names = await db.user.findMany({
    where: { id: { in: people.map((p) => p.id) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(names.map((row) => [row.id, row.name]));

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true, name: true },
  });
  const zone = organization?.timezone ?? 'Asia/Calcutta';

  const result = await queueNotifications({
    organizationId,
    eventKey,
    recipients: people.map((person) => ({
      userId: person.id,
      email: person.email,
      phone: person.phone,
    })),
    dedupeKey: `${eventKey}:${sessionId}`,
    context: {
      title: session.title,
      date: formatDayLabel(dayKey(session.startsAt, zone), zone, true),
      time: formatTime(session.startsAt, zone),
      organization: organization?.name ?? '',
      ...extra,
    },
    contextFor: (person) => ({ name: nameOf.get(person.userId ?? '') ?? 'there' }),
  });

  return describeQueue(result);
}
