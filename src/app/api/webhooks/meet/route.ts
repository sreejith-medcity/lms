import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { getTenantContext } from '@/lib/tenant';
import { lateAfterMinutes, recordAttendance } from '@/lib/attendance';
import { statusForJoin } from '@/lib/attendance-rules';
import { meetAssetKey, verifyMeetSignature } from '@/lib/medcity-meet';

export const dynamic = 'force-dynamic';

/**
 * What Medcity Meet tells us happened: a class started or ended, who was in
 * it and for how long, and that a recording is ready.
 *
 * Same rules as the Zoom and payment webhooks. The delivery is stored before
 * it is processed, a retry is a duplicate, and once the signature checks out
 * the answer is 200 even when processing fails, so a poison event is kept for
 * replay rather than retried forever.
 */

interface Attendee {
  name: string;
  role: string;
  externalUserId: string | null;
  firstJoin: string;
  lastLeave: string | null;
  minutes: number;
  joins: number;
}

interface Envelope {
  id?: string;
  event?: string;
  data?: {
    code?: string;
    externalId?: string | null;
    title?: string;
    attendees?: Attendee[];
    // recording.ready
    id?: string;
    durationSec?: number | null;
    sizeBytes?: number | null;
    startedAt?: string;
  };
}

export async function POST(request: Request) {
  const raw = await request.text();
  let envelope: Envelope;
  try {
    envelope = JSON.parse(raw) as Envelope;
  } catch {
    return NextResponse.json({ error: 'Not JSON.' }, { status: 400 });
  }

  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ error: 'Unknown host.' }, { status: 404 });

  const meet = await resolveIntegration(tenant.organizationId, 'medcity_meet');
  const secret = meet?.values.webhookSecret;
  if (!secret) return NextResponse.json({ error: 'Medcity Meet is not connected here.' }, { status: 503 });

  const signatureOk = verifyMeetSignature(secret, raw, request.headers.get('x-mm-signature'));
  const eventId = envelope.id ?? `${envelope.event ?? 'unknown'}:${envelope.data?.code ?? ''}:${Date.now()}`;

  const stored = await db.providerEvent.upsert({
    where: { provider_eventId: { provider: 'medcity_meet', eventId } },
    create: {
      organizationId: tenant.organizationId,
      provider: 'medcity_meet',
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
      provider: 'medcity_meet',
      direction: 'IN',
      action: envelope.event ?? 'unknown',
      ok: false,
      detail: 'The signature did not match, so nothing was done with it. Check the webhook secret on the Medcity Meet card.',
    });
    return NextResponse.json({ error: 'Bad signature.' }, { status: 401 });
  }
  if (stored.processedAt) return NextResponse.json({ ok: true, duplicate: true });

  let records = 0;
  try {
    records = await handle(tenant.organizationId, envelope);
    await db.providerEvent.update({ where: { id: stored.id }, data: { processedAt: new Date(), error: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.providerEvent.update({ where: { id: stored.id }, data: { error: message.slice(0, 400) } });
    await recordIntegrationEvent({ organizationId: tenant.organizationId, provider: 'medcity_meet', direction: 'IN', action: envelope.event ?? 'unknown', ok: false, detail: message });
    return NextResponse.json({ ok: true, stored: true });
  }

  await recordIntegrationEvent({ organizationId: tenant.organizationId, provider: 'medcity_meet', direction: 'IN', action: envelope.event ?? 'unknown', ok: true, records });
  return NextResponse.json({ ok: true });
}

async function handle(organizationId: string, envelope: Envelope): Promise<number> {
  if (envelope.event === 'ping') return 0;
  const code = envelope.data?.code;
  if (!code) return 0;

  const session = await db.liveSession.findFirst({
    where: { organizationId, provider: 'MEET', providerMeetingId: code },
    select: { id: true, title: true, startsAt: true, batchId: true, status: true },
  });
  // A meeting made in Meet directly, not from here. Stored above, ignored here.
  if (!session) return 0;

  switch (envelope.event) {
    case 'meeting.started':
      if (session.status === 'SCHEDULED') await db.liveSession.update({ where: { id: session.id }, data: { status: 'LIVE' } });
      return 1;

    case 'meeting.ended':
      if (session.status !== 'CANCELLED') await db.liveSession.update({ where: { id: session.id }, data: { status: 'COMPLETED' } });
      return 1;

    case 'attendance.ready':
      return applyAttendance(organizationId, session, envelope.data?.attendees ?? []);

    case 'recording.ready': {
      const recId = envelope.data?.id;
      if (!recId) return 0;
      const storageKey = meetAssetKey(code, recId);
      const existing = await db.asset.findFirst({ where: { organizationId, storageKey }, select: { id: true } });
      if (existing) return 0;
      const day = envelope.data?.startedAt ? new Date(envelope.data.startedAt) : session.startsAt;
      const title = `${session.title}, ${day.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}`;
      // The file stays in Meet's storage. The asset route asks Meet for a fresh
      // link each time it is played, after the usual entitlement check.
      const asset = await db.asset.create({
        data: {
          organizationId,
          name: title,
          fileName: `${code}.mp4`,
          type: 'VIDEO',
          storageKey,
          mimeType: 'video/mp4',
          sizeBytes: BigInt(Math.max(0, Math.round(envelope.data?.sizeBytes ?? 0))),
          durationSeconds: envelope.data?.durationSec ?? null,
          transcodeStatus: 'READY',
        },
        select: { id: true },
      });
      await db.recording.create({ data: { sessionId: session.id, assetId: asset.id, title } });
      return 1;
    }

    default:
      return 0;
  }
}

/**
 * The class's attendance as Meet measured it. Learners only, matched by their
 * id here (Meet was given it in the join link). A first join records the mark;
 * time in the room and the last leave are filled in on top, and a mark the
 * teacher already made stands, except an absence, which a join corrects.
 */
async function applyAttendance(
  organizationId: string,
  session: { id: string; startsAt: Date; batchId: string | null },
  attendees: Attendee[],
): Promise<number> {
  const ids = attendees.map((a) => a.externalUserId).filter((x): x is string => Boolean(x));
  if (!ids.length) return 0;
  const learners = await db.user.findMany({ where: { organizationId, id: { in: ids }, kind: 'LEARNER' }, select: { id: true } });
  const known = new Set(learners.map((l) => l.id));
  const grace = await lateAfterMinutes(organizationId, session.batchId ?? null);
  let n = 0;

  for (const a of attendees) {
    if (!a.externalUserId || !known.has(a.externalUserId)) continue;
    const joinedAt = new Date(a.firstJoin);
    const leftAt = a.lastLeave ? new Date(a.lastLeave) : null;
    const minutesLate = Math.max(0, Math.round((joinedAt.getTime() - session.startsAt.getTime()) / 60_000));
    const existing = await db.attendance.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId: a.externalUserId } },
      select: { id: true, status: true, joinedAt: true, minutesPresent: true },
    });

    if (!existing) {
      await recordAttendance({ organizationId, sessionId: session.id, userId: a.externalUserId, status: statusForJoin(minutesLate, grace), source: 'PROVIDER', joinedAt, wasInTime: minutesLate <= grace });
    } else if (existing.status === 'ABSENT') {
      await recordAttendance({ organizationId, sessionId: session.id, userId: a.externalUserId, status: statusForJoin(minutesLate, grace), source: 'PROVIDER', reason: 'Meet shows they joined the class', joinedAt, wasInTime: minutesLate <= grace });
    }

    await db.attendance.update({
      where: { sessionId_userId: { sessionId: session.id, userId: a.externalUserId } },
      data: {
        // The earliest arrival wins: the Join button may have written a later one.
        ...(!existing?.joinedAt || existing.joinedAt > joinedAt ? { joinedAt } : {}),
        ...(leftAt ? { leftAt } : {}),
        minutesPresent: Math.max(existing?.minutesPresent ?? 0, Math.round(a.minutes)),
      },
    });
    n += 1;
  }
  if (n) {
    const { afterLearning } = await import('@/lib/badges-data');
    for (const id of known) await afterLearning(organizationId, id).catch(() => {});
  }
  return n;
}
