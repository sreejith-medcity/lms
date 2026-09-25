import { db } from '@/lib/db';
import { zoomFor, createMeeting, deleteMeeting, updateMeeting, ZoomError } from '@/lib/zoom';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { meetFor, createClass, moveClass, cancelClass, MeetError } from '@/lib/medcity-meet';

/**
 * Giving classes their Zoom meetings.
 *
 * Not at the moment they are scheduled, or at least not all of them. A term of
 * twice-weekly classes is fifty rows, and fifty Zoom calls inside one form
 * submission is a request that times out halfway through and leaves half a term
 * with join links and half without.
 *
 * So the meeting is created ahead of the class rather than with it: a fortnight
 * out, in batches, by the same scheduled job that drains the outbox. A class
 * further away than that has no join link yet, which is honest, and the screen
 * says so rather than showing an empty field.
 *
 * The small case is still handled inline. Scheduling one class and not getting a
 * link until the next cron run would be baffling.
 */

const HORIZON_DAYS = 14;

export interface ProvisionResult {
  created: number;
  failed: number;
  skipped: number;
  reason?: string;
}

/**
 * Rooms for upcoming classes, on whichever platform the academy uses.
 * Medcity Meet takes over once it is connected; Zoom stays for academies
 * that have not moved, and for classes that already have a Zoom meeting.
 */
export async function provisionMeetings(
  organizationId: string,
  options: { limit?: number; sessionIds?: string[] } = {},
): Promise<ProvisionResult> {
  const meet = await meetFor(organizationId);
  if (meet) return provisionMeetRooms(organizationId, meet, options);
  return provisionZoomMeetings(organizationId, options);
}

/** The path a learner or trainer opens: it mints their personal Meet link. */
export const meetJoinPath = (sessionId: string) => `/live/${sessionId}/join`;

async function provisionMeetRooms(
  organizationId: string,
  client: NonNullable<Awaited<ReturnType<typeof meetFor>>>,
  options: { limit?: number; sessionIds?: string[] },
): Promise<ProvisionResult> {
  // Meet makes a room in well under a second and has no seat limit, so the
  // horizon is the same fortnight but a run can take more of them.
  const horizon = new Date(Date.now() + HORIZON_DAYS * 86_400_000);
  const due = await db.liveSession.findMany({
    where: {
      organizationId,
      ...(options.sessionIds ? { id: { in: options.sessionIds } } : {}),
      providerMeetingId: null,
      provider: { in: ['ZOOM', 'MEET'] },
      // A link typed in by hand is the trainer's choice; leave it alone.
      joinUrl: null,
      status: 'SCHEDULED',
      cancelledAt: null,
      isHoliday: false,
      startsAt: { gte: new Date(), lte: options.sessionIds ? undefined : horizon },
    },
    orderBy: { startsAt: 'asc' },
    take: options.limit ?? 50,
    select: {
      id: true,
      title: true,
      topics: true,
      startsAt: true,
      endsAt: true,
      autoRecord: true,
      learnerId: true,
      batch: { select: { name: true } },
      instructors: {
        orderBy: { isPrimary: 'desc' },
        take: 3,
        select: { isPrimary: true, instructor: { select: { user: { select: { email: true, name: true } } } } },
      },
    },
  });
  if (!due.length) return { created: 0, failed: 0, skipped: 0 };

  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });

  let created = 0;
  let failed = 0;
  let skipped = 0;
  let stopReason: string | undefined;
  let lastError: string | undefined;

  for (const session of due) {
    if (stopReason) {
      skipped += 1;
      continue;
    }
    const host = session.instructors.map((i) => i.instructor.user).find((u) => u.email);
    if (!host?.email) {
      failed += 1;
      lastError = `"${session.title}" has no trainer with an email, so Meet has nobody to make host.`;
      continue;
    }
    try {
      const meeting = await createClass(client, {
        sessionId: session.id,
        title: session.batch?.name ? `${session.title} (${session.batch.name})` : session.title,
        topics: session.topics,
        hostEmail: host.email,
        hostName: host.name ?? undefined,
        startsAt: session.startsAt,
        minutes: Math.round((session.endsAt.getTime() - session.startsAt.getTime()) / 60_000),
        timezone: organization?.timezone ?? 'Asia/Kolkata',
        oneToOne: Boolean(session.learnerId),
        autoRecord: session.autoRecord,
      });
      await db.liveSession.update({
        where: { id: session.id },
        data: {
          provider: 'MEET',
          providerMeetingId: meeting.code,
          providerHostId: host.email,
          joinUrl: meetJoinPath(session.id),
          hostUrl: meetJoinPath(session.id),
        },
      });
      created += 1;
    } catch (err) {
      failed += 1;
      lastError = err instanceof Error ? err.message : String(err);
      if (err instanceof MeetError && err.permanent && err.code !== 'invalid_schedule') stopReason = lastError;
    }
  }

  await recordIntegrationEvent({
    organizationId,
    provider: 'medcity_meet',
    direction: 'OUT',
    action: 'Class rooms created',
    ok: failed === 0,
    records: created,
    detail: stopReason ?? lastError ?? null,
  });
  return { created, failed, skipped, reason: stopReason ?? lastError };
}

async function provisionZoomMeetings(
  organizationId: string,
  options: { limit?: number; sessionIds?: string[] } = {},
): Promise<ProvisionResult> {
  const client = await zoomFor(organizationId);
  if (!client) {
    return {
      created: 0,
      failed: 0,
      skipped: 0,
      reason: 'Zoom is not connected, so classes keep whatever join link was typed in by hand.',
    };
  }

  const horizon = new Date(Date.now() + HORIZON_DAYS * 86_400_000);

  const due = await db.liveSession.findMany({
    where: {
      organizationId,
      ...(options.sessionIds ? { id: { in: options.sessionIds } } : {}),
      providerMeetingId: null,
      provider: 'ZOOM',
      status: 'SCHEDULED',
      cancelledAt: null,
      isHoliday: false,
      startsAt: { gte: new Date(), lte: options.sessionIds ? undefined : horizon },
    },
    orderBy: { startsAt: 'asc' },
    take: options.limit ?? 25,
    select: {
      id: true,
      title: true,
      topics: true,
      startsAt: true,
      endsAt: true,
      autoRecord: true,
      batch: { select: { name: true } },
      instructors: {
        where: { isPrimary: true },
        take: 1,
        select: { instructor: { select: { user: { select: { email: true } } } } },
      },
    },
  });

  if (!due.length) return { created: 0, failed: 0, skipped: 0 };

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });

  let created = 0;
  let failed = 0;
  let skipped = 0;
  let stopReason: string | undefined;
  let lastError: string | undefined;

  for (const session of due) {
    if (stopReason) {
      skipped += 1;
      continue;
    }

    try {
      const meeting = await createMeeting(client, {
        // The trainer's own Zoom seat where they have one, so the class shows up
        // in their app rather than only in the account owner's.
        hostEmail: session.instructors[0]?.instructor.user.email ?? undefined,
        topic: session.batch?.name ? `${session.title} (${session.batch.name})` : session.title,
        startsAt: session.startsAt,
        minutes: Math.max(
          5,
          Math.round((session.endsAt.getTime() - session.startsAt.getTime()) / 60_000),
        ),
        timezone: organization?.timezone ?? 'Asia/Calcutta',
        autoRecord: session.autoRecord,
        agenda: session.topics ?? undefined,
      });

      await db.liveSession.update({
        where: { id: session.id },
        data: {
          providerMeetingId: meeting.meetingId,
          providerHostId: meeting.hostId,
          joinUrl: meeting.joinUrl,
          hostUrl: meeting.hostUrl,
        },
      });
      created += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;

      // A wrong scope or a missing licence fails identically for every class in
      // the list, so there is no sense making the same call twenty five times.
      if (err instanceof ZoomError && err.permanent && err.status !== 404) {
        stopReason = message;
      }
    }
  }

  await recordIntegrationEvent({
    organizationId,
    provider: 'zoom',
    direction: 'OUT',
    action: 'Meetings created',
    ok: failed === 0,
    records: created,
    detail: stopReason ?? lastError ?? null,
  });

  // A transient failure is still a failure the person scheduling should
  // hear about; only the permanent kind stops the loop.
  return { created, failed, skipped, reason: stopReason ?? lastError };
}

/** Keeps Zoom in step when a class is moved. */
export async function syncMeeting(organizationId: string, sessionId: string): Promise<void> {
  const session = await db.liveSession.findFirst({
    where: { id: sessionId, organizationId },
    select: { providerMeetingId: true, provider: true, title: true, startsAt: true, endsAt: true },
  });
  if (!session?.providerMeetingId) return;

  if (session.provider === 'MEET') {
    const meet = await meetFor(organizationId);
    if (!meet) return;
    await moveClass(meet, sessionId, {
      title: session.title,
      startsAt: session.startsAt,
      minutes: Math.round((session.endsAt.getTime() - session.startsAt.getTime()) / 60_000),
    }).catch((err: unknown) => {
      console.error('[meet] could not move the class:', err instanceof Error ? err.message : err);
    });
    return;
  }

  const client = await zoomFor(organizationId);
  if (!client) return;

  await updateMeeting(client, session.providerMeetingId, {
    topic: session.title,
    startsAt: session.startsAt,
    minutes: Math.max(
      5,
      Math.round((session.endsAt.getTime() - session.startsAt.getTime()) / 60_000),
    ),
  }).catch((err: unknown) => {
    console.error('[zoom] could not move the meeting:', err instanceof Error ? err.message : err);
  });
}

/**
 * A cancelled class should not still be joinable. The meeting is removed from
 * Zoom and the link cleared here, so a learner who kept the old email finds
 * nothing rather than sitting alone in a room.
 */
export async function releaseMeeting(organizationId: string, sessionId: string): Promise<void> {
  const session = await db.liveSession.findFirst({
    where: { id: sessionId, organizationId },
    select: { providerMeetingId: true, provider: true },
  });
  if (!session?.providerMeetingId) return;

  if (session.provider === 'MEET') {
    const meet = await meetFor(organizationId);
    if (meet) {
      await cancelClass(meet, sessionId).catch((err: unknown) => {
        console.error('[meet] could not cancel the class:', err instanceof Error ? err.message : err);
      });
    }
    await db.liveSession.update({ where: { id: sessionId }, data: { providerMeetingId: null, joinUrl: null, hostUrl: null } });
    return;
  }

  const client = await zoomFor(organizationId);
  if (!client) return;

  try {
    await deleteMeeting(client, session.providerMeetingId);
  } catch (err) {
    console.error('[zoom] could not delete the meeting:', err instanceof Error ? err.message : err);
  }

  await db.liveSession.update({
    where: { id: sessionId },
    data: { providerMeetingId: null, joinUrl: null, hostUrl: null },
  });
}
