import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { curriculumGate } from '@/lib/curriculum-access';
import type { ActionState } from '@/server/courses';

/**
 * "May this learner touch this lesson?", answered once for notes, bookmarks,
 * the resume position and questions, so none of them can be reached by
 * guessing a material id.
 *
 * Not a server action file: this is a library, imported by the actions that
 * need it, never callable from a browser on its own.
 */
export async function entitledToLesson(materialId: string) {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) throw new Error('SIGN_IN_REQUIRED');

  const enrollment = await db.enrollment.findFirst({
    where: {
      userId: user.id,
      organizationId: tenant.organizationId,
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      product: {
        course: {
          modules: {
            some: {
              module: { sections: { some: { materials: { some: { id: materialId } } } } },
            },
          },
        },
      },
    },
    select: {
      id: true,
      productId: true,
      batchId: true,
      createdAt: true,
      product: { select: { course: { select: { id: true } } } },
    },
  });
  if (!enrollment) throw new Error('NOT_ENROLLED');

  // Enrolled is not the same as released: a dripped lesson is refused here too,
  // because a lock only the page knows about is a lock anyone can walk past.
  const courseId = enrollment.product.course?.id;
  if (courseId) {
    const material = await db.material.findUnique({
      where: { id: materialId },
      select: { sectionId: true, section: { select: { isVisible: true } } },
    });
    if (!material || !material.section.isVisible) throw new Error('NOT_OPEN_YET');

    const gate = await curriculumGate({
      courseId,
      enrolledAt: enrollment.createdAt,
      batchId: enrollment.batchId,
    });
    if (gate.lockOf(materialId, material.sectionId)) throw new Error('NOT_OPEN_YET');
  }

  return { tenant, user, enrollment, courseId: courseId ?? null };
}

export function lessonFail(tag: string, err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'SIGN_IN_REQUIRED') return { error: 'Please sign in again.' };
  if (message === 'NOT_ENROLLED') return { error: 'This lesson is not part of your enrolment.' };
  if (message === 'NOT_OPEN_YET') return { error: 'This lesson has not opened yet.' };
  if (message === 'UNAUTHORIZED' || message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  if (message === 'NOT_FOUND') return { error: 'That question is no longer here.' };
  console.error(`[${tag}]`, message);
  return { error: 'Something went wrong. Please try again.' };
}
