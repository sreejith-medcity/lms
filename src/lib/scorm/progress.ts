import { db } from '@/lib/db';

/**
 * A package saying "done" becomes the lesson being done, the same row the
 * tick button writes, so the course's progress, certificates and badges
 * follow without knowing where the completion came from.
 */
export async function markScormMaterialDone(organizationId: string, userId: string, materialId: string): Promise<void> {
  const enrollment = await db.enrollment.findFirst({
    where: { organizationId, userId, status: { notIn: ['CANCELLED', 'ARCHIVED'] }, product: { course: { modules: { some: { module: { sections: { some: { materials: { some: { id: materialId } } } } } } } } } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, productId: true },
  });
  await db.materialProgress.upsert({
    where: { userId_materialId: { userId, materialId } },
    create: { userId, materialId, enrollmentId: enrollment?.id ?? null, percent: 100, completedAt: new Date(), lastViewedAt: new Date() },
    update: { percent: 100, completedAt: new Date(), lastViewedAt: new Date() },
  });
  if (enrollment) {
    const { recomputeEnrollmentProgress } = await import('@/server/enrollment');
    await recomputeEnrollmentProgress(enrollment.id).catch(() => null);
    const { afterLearning } = await import('@/lib/badges-data');
    await afterLearning(organizationId, userId);
  }
}
