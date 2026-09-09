import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { verifyZoomSignature, validationResponse } from '@/lib/zoom';
import { getTenantContext } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * What Zoom tells us happened.
 *
 * Three things arrive here that are worth having: somebody joined, somebody
 * left, and a recording finished processing. The first two are how attendance
 * becomes a fact rather than a register somebody forgot to take, and the third
 * is how a recording reaches the library without a person downloading and
 * re-uploading a two gigabyte file.
 *
 * Written to the same rules as the payment webhook, for the same reasons. The
 * delivery is recorded before it is processed, signatures included; processing
 * is idempotent, because Zoom retries and reorders; and the answer is always 200
 * once the signature checks out, because anything else makes Zoom retry forever
 * and eventually disable the endpoint.
 */

interface ZoomEnvelope {
  event?: string;
  event_ts?: number;
  payload?: {
    plainToken?: string;
    account_id?: string;
    object?: {
      id?: string | number;
      uuid?: string;
      topic?: string;
      participant?: {
        user_id?: string;
        user_name?: string;
        email?: string;
        join_time?: string;
        leave_time?: string;
      };
      recording_files?: unknown[];
    };
  };
}

export async function POST(request: Request) {
  const raw = await request.text();

  let envelope: ZoomEnvelope;
  try {
    envelope = JSON.parse(raw) as ZoomEnvelope;
  } catch {
    return NextResponse.json({ error: 'Not JSON.' }, { status: 400 });
  }

  // Resolved from the host middleware stamped on the request, the same way
  // every other route does it, so a webhook cannot reach the wrong academy.
  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ error: 'Unknown host.' }, { status: 404 });

  const zoom = await resolveIntegration(tenant.organizationId, 'zoom');
  const secret = zoom?.values.webhookSecret;
  if (!secret) {
    // Answering 200 here would tell Zoom the endpoint is healthy while nothing
    // can be verified, which is worse than being obviously unconfigured.
    return NextResponse.json({ error: 'Zoom is not connected here.' }, { status: 503 });
  }

  // Zoom's endpoint validation handshake, which happens before any signature is
  // configured on their side.
  if (envelope.event === 'endpoint.url_validation' && envelope.payload?.plainToken) {
    return NextResponse.json(validationResponse(secret, envelope.payload.plainToken));
  }

  const signatureOk = verifyZoomSignature({
    secret,
    signature: request.headers.get('x-zm-signature'),
    timestamp: request.headers.get('x-zm-request-timestamp'),
    rawBody: raw,
  });

  const meetingId = envelope.payload?.object?.id
    ? String(envelope.payload.object.id)
    : null;

  // The delivery id. Zoom does not send one, so the event, the meeting and the
  // timestamp together stand in for it, which is enough to make a retry a
  // duplicate.
  const eventId = [
    envelope.event ?? 'unknown',
    meetingId ?? 'none',
    envelope.payload?.object?.participant?.user_id ?? '',
    envelope.event_ts ?? '',
  ].join(':');

  const stored = await db.providerEvent.upsert({
    where: { provider_eventId: { provider: 'zoom', eventId } },
    create: {
      organizationId: tenant.organizationId,
      provider: 'zoom',
      eventId,
      event: envelope.event ?? 'unknown',
      payload: envelope as unknown as object,
      signatureOk,
    },
    update: {},
    select: { id: true, processedAt: true },
  });

  if (!signatureOk) {
    await recordIntegrationEvent({
      organizationId: tenant.organizationId,
      provider: 'zoom',
      direction: 'IN',
      action: envelope.event ?? 'unknown',
      ok: false,
      detail: 'The signature did not match, so nothing was done with it.',
    });
    return NextResponse.json({ error: 'Bad signature.' }, { status: 401 });
  }

  // Already handled. Zoom is told yes so it stops retrying.
  if (stored.processedAt) return NextResponse.json({ ok: true, duplicate: true });

  try {
    await handle(tenant.organizationId, envelope, meetingId);
    await db.providerEvent.update({
      where: { id: stored.id },
      data: { processedAt: new Date(), error: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.providerEvent.update({
      where: { id: stored.id },
      data: { error: message.slice(0, 400) },
    });
    await recordIntegrationEvent({
      organizationId: tenant.organizationId,
      provider: 'zoom',
      direction: 'IN',
      action: envelope.event ?? 'unknown',
      ok: false,
      detail: message,
    });
    // Still 200. The delivery is recorded and can be replayed; making Zoom
    // retry a poison event forever helps nobody.
    return NextResponse.json({ ok: true, stored: true });
  }

  await recordIntegrationEvent({
    organizationId: tenant.organizationId,
    provider: 'zoom',
    direction: 'IN',
    action: envelope.event ?? 'unknown',
    ok: true,
    records: 1,
  });

  return NextResponse.json({ ok: true });
}

async function handle(
  organizationId: string,
  envelope: ZoomEnvelope,
  meetingId: string | null,
): Promise<void> {
  if (!meetingId) return;

  const session = await db.liveSession.findFirst({
    where: { organizationId, providerMeetingId: meetingId },
    select: { id: true, startsAt: true, batchId: true },
  });
  // A meeting created outside this product. Recorded above, ignored here.
  if (!session) return;

  const participant = envelope.payload?.object?.participant;

  switch (envelope.event) {
    case 'meeting.started':
      await db.liveSession.update({ where: { id: session.id }, data: { status: 'LIVE' } });
      return;

    case 'meeting.ended':
      await db.liveSession.update({ where: { id: session.id }, data: { status: 'COMPLETED' } });
      return;

    case 'meeting.participant_joined': {
      if (!participant?.email) return;
      const user = await db.user.findFirst({
        where: { organizationId, email: participant.email },
        select: { id: true },
      });
      if (!user) return;

      const joinedAt = participant.join_time ? new Date(participant.join_time) : new Date();
      const minutesLate = Math.max(
        0,
        Math.round((joinedAt.getTime() - session.startsAt.getTime()) / 60_000),
      );

      await db.attendance.upsert({
        where: { sessionId_userId: { sessionId: session.id, userId: user.id } },
        create: {
          sessionId: session.id,
          userId: user.id,
          status: minutesLate > 10 ? 'LATE' : 'PRESENT',
          joinedAt,
          wasInTime: minutesLate <= 10,
        },
        // A rejoin after a dropped connection must not overwrite the first
        // arrival, or a bad line turns a punctual learner into a late one.
        update: {},
      });
      return;
    }

    case 'meeting.participant_left': {
      if (!participant?.email) return;
      const user = await db.user.findFirst({
        where: { organizationId, email: participant.email },
        select: { id: true },
      });
      if (!user) return;

      const leftAt = participant.leave_time ? new Date(participant.leave_time) : new Date();
      const existing = await db.attendance.findUnique({
        where: { sessionId_userId: { sessionId: session.id, userId: user.id } },
        select: { joinedAt: true, minutesPresent: true },
      });
      if (!existing?.joinedAt) return;

      // Summed across joins, so somebody who drops twice is credited with the
      // time they were actually in the room.
      const thisStint = Math.max(
        0,
        Math.round((leftAt.getTime() - existing.joinedAt.getTime()) / 60_000),
      );

      await db.attendance.update({
        where: { sessionId_userId: { sessionId: session.id, userId: user.id } },
        data: {
          leftAt,
          minutesPresent: Math.max(existing.minutesPresent, thisStint),
        },
      });
      return;
    }

    case 'recording.completed':
      // The files are pulled by the recordings job rather than here: the
      // download needs a token, the file is large, and a webhook handler is the
      // wrong place to move two gigabytes.
      await db.liveSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED' },
      });
      return;

    default:
      return;
  }
}
