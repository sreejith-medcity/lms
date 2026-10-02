import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { bearerMatches, instructorMinutes, isOneToOne, parseWindow, type FeedSession } from '@/lib/hrsuite-feed';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/hrsuite/classes?from=2026-10-01T00:00:00%2B05:30&to=2026-11-01T00:00:00%2B05:30
 * Authorization: Bearer <the shared secret set under Integrations, HRSuite>
 *
 * Every class in the window (held, cancelled, not yet taken) with its
 * tutors, each with their employee code where the office has set one. Where the office did not name a tutor on the class, the batch's
 * primary tutor took it, as the payouts here read it.
 */
export async function GET(request: Request) {
  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ error: 'Unknown host.' }, { status: 404 });
  const resolved = await resolveIntegration(tenant.organizationId, 'hrsuite');
  const secret = resolved?.values.sharedSecret;
  if (!secret) return NextResponse.json({ error: 'HRSuite is not connected here.' }, { status: 503 });
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    await recordIntegrationEvent({ organizationId: tenant.organizationId, provider: 'hrsuite', direction: 'IN', action: 'Classes refused', ok: false, detail: 'Wrong or missing token.' });
    return NextResponse.json({ error: 'Wrong or missing token.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const window = parseWindow(url.searchParams.get('from'), url.searchParams.get('to'));
  if (!window.ok) return NextResponse.json({ error: window.error }, { status: 400 });

  const sessions = await db.liveSession.findMany({
    where: { organizationId: tenant.organizationId, isHoliday: false, startsAt: { gte: window.from, lt: window.to } },
    orderBy: { startsAt: 'asc' },
    take: 5000,
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      cancelledAt: true,
      cancelReason: true,
      provider: true,
      learnerId: true,
      batchId: true,
      registerSubmittedAt: true,
      batch: { select: { id: true, name: true, mode: true, level: true, isTutoring: true, course: { select: { product: { select: { title: true } } } }, _count: { select: { enrollments: true } } } },
      instructors: { select: { userId: true, isPrimary: true } },
      attendances: { select: { userId: true, status: true, joinedAt: true, leftAt: true, minutesPresent: true } },
      _count: { select: { recordings: true } },
    },
  });

  // Classes with no tutor named fall back to the batch's primary tutor.
  const unnamed = Array.from(new Set(sessions.filter((s) => s.instructors.length === 0 && s.batchId).map((s) => s.batchId as string)));
  const primaries = unnamed.length
    ? await db.batchStaff.findMany({ where: { batchId: { in: unnamed }, role: 'PRIMARY_TUTOR', batch: { organizationId: tenant.organizationId } }, select: { batchId: true, userId: true, startsOn: true, endsOn: true } })
    : [];

  const tutorIds = new Set<string>();
  const tutorsOf = new Map<string, Array<{ userId: string; isPrimary: boolean }>>();
  for (const s of sessions) {
    const named = s.instructors.map((i) => ({ userId: i.userId, isPrimary: i.isPrimary }));
    const fallback = named.length
      ? []
      : primaries
          .filter((p) => p.batchId === s.batchId && (!p.startsOn || p.startsOn <= s.startsAt) && (!p.endsOn || p.endsOn >= s.startsAt))
          .map((p) => ({ userId: p.userId, isPrimary: true }));
    const list = named.length ? named : fallback;
    list.forEach((t) => tutorIds.add(t.userId));
    tutorsOf.set(s.id, list);
  }
  const people = tutorIds.size
    ? await db.user.findMany({
        where: { organizationId: tenant.organizationId, id: { in: Array.from(tutorIds) } },
        select: { id: true, name: true, email: true, phone: true, instructorProfile: { select: { employeeCode: true } } },
      })
    : [];
  const person = new Map(people.map((p) => [p.id, p]));

  // An online tutor's group knows how many learners it seats: one is one to one.
  const tutoringBatches = Array.from(new Set(sessions.filter((s) => s.batch?.isTutoring).map((s) => s.batchId as string)));
  const groups = tutoringBatches.length
    ? await db.tutoringGroup.findMany({ where: { organizationId: tenant.organizationId, batchId: { in: tutoringBatches } }, select: { batchId: true, capacity: true } })
    : [];
  const capacityOf = new Map(groups.map((g) => [g.batchId, g.capacity]));

  const out: FeedSession[] = sessions.map((s) => {
    const tutors = tutorsOf.get(s.id) ?? [];
    const tutorSet = new Set(tutors.map((t) => t.userId));
    const learnerRows = s.attendances.filter((a) => !tutorSet.has(a.userId));
    const present = learnerRows.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
    return {
      id: s.id,
      title: s.title,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      status: s.status,
      cancelledAt: s.cancelledAt ? s.cancelledAt.toISOString() : null,
      cancelReason: s.cancelReason,
      oneToOne: isOneToOne(s, s.batchId ? capacityOf.get(s.batchId) : undefined),
      tutoring: Boolean(s.batch?.isTutoring),
      batch: s.batch ? { id: s.batch.id, name: s.batch.name, mode: s.batch.mode, level: s.batch.level } : null,
      course: s.batch?.course?.product?.title ?? null,
      provider: s.provider,
      registerSubmitted: Boolean(s.registerSubmittedAt),
      learnersExpected: s.learnerId ? 1 : (s.batch?._count.enrollments ?? null),
      learnersPresent: s.registerSubmittedAt || learnerRows.length ? present : null,
      hasRecording: s._count.recordings > 0,
      instructors: tutors.map((t) => {
        const p = person.get(t.userId);
        const own = s.attendances.find((a) => a.userId === t.userId);
        return {
          userId: t.userId,
          employeeCode: p?.instructorProfile?.employeeCode ?? null,
          email: p?.email ?? null,
          name: p?.name ?? null,
          phone: p?.phone ?? null,
          isPrimary: t.isPrimary,
          joinedAt: own?.joinedAt ? own.joinedAt.toISOString() : null,
          leftAt: own?.leftAt ? own.leftAt.toISOString() : null,
          minutesPresent: instructorMinutes(own),
        };
      }),
    };
  });

  await recordIntegrationEvent({ organizationId: tenant.organizationId, provider: 'hrsuite', direction: 'OUT', action: 'Classes read', ok: true, records: out.length });
  return NextResponse.json({ ok: true, from: window.from.toISOString(), to: window.to.toISOString(), timezone: tenant.timezone ?? null, sessions: out });
}
