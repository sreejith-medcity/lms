import { db } from '@/lib/db';
import { bearerUser } from '@/lib/api/auth';
import { lessonEntitlement } from '@/lib/api/lessons';
import { fail, ok, readJson } from '@/lib/api/http';
import { recomputeEnrollmentProgress } from '@/server/enrollment';

export const dynamic = 'force-dynamic';

/**
 * POST { positionSeconds?, durationSeconds?, complete? }. The position is
 * where to resume; seconds viewed only ever grow; complete marks the
 * lesson done and moves the course, badges and certificates along.
 */
export async function POST(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { materialId } = await params;
  const ent = await lessonEntitlement(ctx.tenant, ctx.user, materialId);
  if (!ent.ok) return fail(ent.code, ent.message, ent.code === 'locked' ? 423 : 404);
  const body = (await readJson(request)) ?? {};
  const position = Math.max(0, Math.round(Number(body.positionSeconds ?? 0) || 0));
  const duration = Number(body.durationSeconds ?? 0) || 0;
  const complete = body.complete === true;
  const pct = duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : undefined;

  const existing = await db.materialProgress.findUnique({ where: { userId_materialId: { userId: ctx.user.id, materialId } }, select: { secondsViewed: true, percent: true, completedAt: true } });
  const now = new Date();
  await db.materialProgress.upsert({
    where: { userId_materialId: { userId: ctx.user.id, materialId } },
    create: { userId: ctx.user.id, materialId, enrollmentId: ent.enrollmentId, positionSeconds: position, secondsViewed: position, percent: complete ? 100 : pct ?? 0, completedAt: complete ? now : null, lastViewedAt: now },
    update: {
      positionSeconds: position,
      secondsViewed: Math.max(existing?.secondsViewed ?? 0, position),
      percent: complete ? 100 : pct != null ? Math.max(existing?.percent ?? 0, pct) : undefined,
      ...(complete ? { completedAt: existing?.completedAt ?? now } : {}),
      lastViewedAt: now,
    },
  });
  await db.enrollment.update({ where: { id: ent.enrollmentId }, data: { lastActivityAt: now } }).catch(() => null);
  if (complete && !existing?.completedAt) {
    await recomputeEnrollmentProgress(ent.enrollmentId).catch(() => null);
    const { afterLearning } = await import('@/lib/badges-data');
    await afterLearning(ctx.tenant.organizationId, ctx.user.id);
  } else if (pct != null && pct >= 25) {
    const { recordLearningDay } = await import('@/lib/badges-data');
    await recordLearningDay(ctx.tenant.organizationId, ctx.user.id);
  }
  return ok({ saved: true, completed: complete || Boolean(existing?.completedAt) });
}
