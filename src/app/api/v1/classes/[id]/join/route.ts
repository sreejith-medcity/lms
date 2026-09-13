import { db } from '@/lib/db';
import { bearerUser } from '@/lib/api/auth';
import { fail, ok } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

const IN_TIME_GRACE_MINUTES = 10;

/** POST → the join link, and attendance taken the way the web's Join button takes it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { id } = await params;
  const session = await db.liveSession.findFirst({ where: { id, organizationId: ctx.tenant.organizationId, status: { not: 'CANCELLED' } }, select: { id: true, startsAt: true, joinUrl: true, batchId: true, learnerId: true } });
  if (!session) return fail('not_found', 'That class is not available.', 404);
  if (session.learnerId && session.learnerId !== ctx.user.id) return fail('not_yours', 'That class is not yours.', 403);
  if (!session.learnerId) {
    const enrolled = await db.enrollment.findFirst({ where: { organizationId: ctx.tenant.organizationId, userId: ctx.user.id, batchId: session.batchId, status: { in: ['ENROLLED', 'COMPLETED'] } }, select: { id: true } });
    if (!enrolled && ctx.user.kind !== 'STAFF') return fail('not_in_batch', 'You are not in this batch.', 403);
  }
  if (!session.joinUrl) return fail('no_link', 'The join link is not ready yet. Try again nearer the time.', 409);
  const now = new Date();
  const minutesLate = Math.round((now.getTime() - session.startsAt.getTime()) / 60_000);
  if (ctx.user.kind === 'LEARNER') {
    await db.attendance.upsert({
      where: { sessionId_userId: { sessionId: session.id, userId: ctx.user.id } },
      create: { sessionId: session.id, userId: ctx.user.id, status: minutesLate > IN_TIME_GRACE_MINUTES ? 'LATE' : 'PRESENT', joinedAt: now, wasInTime: minutesLate <= IN_TIME_GRACE_MINUTES },
      update: { joinedAt: now },
    });
    const { afterLearning } = await import('@/lib/badges-data');
    await afterLearning(ctx.tenant.organizationId, ctx.user.id);
  }
  return ok({ url: session.joinUrl });
}
