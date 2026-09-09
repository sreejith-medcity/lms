'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { curriculumGate } from '@/lib/curriculum-access';
import type { ActionState } from '@/server/courses';

/**
 * Self-enrolment. Free plans go through immediately; paid ones wait for the
 * checkout that lands in Phase 3 rather than pretending to have taken money.
 */
export async function enrol(productId: string, pricingPlanId?: string): Promise<ActionState> {
  let destination: string | null = null;

  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { error: 'SIGN_IN_REQUIRED' };

    const product = await db.product.findFirst({
      where: {
        id: productId,
        organizationId: tenant.organizationId,
        status: 'PUBLISHED',
        deletedAt: null,
      },
      include: {
        course: { select: { id: true, onDemandOnly: true } },
        pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!product?.course) return { error: 'That course is not available.' };
    if (product.course.onDemandOnly) {
      return { error: 'This course is enrolled by the academy. Please contact them.' };
    }

    const existing = await db.enrollment.findFirst({
      where: { userId: user.id, productId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
      select: { id: true },
    });
    if (existing) {
      destination = `/learn/${productId}`;
    } else {
      const plan =
        product.pricingPlans.find((p) => p.id === pricingPlanId) ?? product.pricingPlans[0];

      if (plan && plan.pricePaise > 0) {
        return { error: 'Paid checkout is not live yet. Ask the academy to enrol you for now.' };
      }

      const branch = await db.branch.findFirst({
        where: { organizationId: tenant.organizationId, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!branch) return { error: 'This academy has no branch configured.' };

      const batch = await db.batch.findFirst({
        where: { courseId: product.course.id, status: { in: ['ACTIVE', 'UPCOMING'] } },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true },
      });

      await db.enrollment.create({
        data: {
          organizationId: tenant.organizationId,
          branchId: branch.id,
          userId: user.id,
          productId,
          batchId: batch?.id,
          pricingPlanId: plan?.id,
          status: 'ENROLLED',
          source: 'SELF',
          startsAt: new Date(),
          expiresAt:
            plan?.validityDays != null
              ? new Date(Date.now() + plan.validityDays * 864e5)
              : null,
        },
      });

      if (user.kind === 'LEARNER') {
        await db.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
      }

      destination = `/learn/${productId}`;
    }
  } catch (err) {
    console.error('[enrollment]', err instanceof Error ? err.message : err);
    return { error: 'Could not enrol you just now. Please try again.' };
  }

  revalidatePath('/learn');
  if (destination) redirect(destination);
  return { ok: true };
}

/** Marks one material done and recomputes the enrolment's progress. */
export async function setMaterialComplete(
  productId: string,
  materialId: string,
  complete: boolean,
): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { error: 'SIGN_IN_REQUIRED' };

    const enrollment = await db.enrollment.findFirst({
      where: {
        userId: user.id,
        productId,
        organizationId: tenant.organizationId,
        status: { in: ['ENROLLED', 'REGISTERED', 'COMPLETED'] },
      },
      select: {
        id: true,
        batchId: true,
        createdAt: true,
        product: { select: { course: { select: { id: true } } } },
      },
    });
    if (!enrollment?.product.course) return { error: 'You are not enrolled in that course.' };

    const material = await db.material.findFirst({
      where: {
        id: materialId,
        section: { module: { courses: { some: { courseId: enrollment.product.course.id } } } },
      },
      select: {
        id: true,
        sectionId: true,
        section: { select: { isVisible: true, moduleId: true } },
      },
    });
    if (!material) return { error: 'That material is not part of this course.' };

    // A lesson that has not opened cannot be ticked off, however the tick arrives.
    const gate = await curriculumGate({
      courseId: enrollment.product.course.id,
      enrolledAt: enrollment.createdAt,
      batchId: enrollment.batchId,
    });
    if (
      complete &&
      (!material.section.isVisible ||
        !gate.teaches(material.section.moduleId) ||
        gate.lockOf(material.id, material.sectionId))
    ) {
      return { error: 'This lesson has not opened yet.' };
    }

    await db.materialProgress.upsert({
      where: { userId_materialId: { userId: user.id, materialId } },
      create: {
        userId: user.id,
        materialId,
        enrollmentId: enrollment.id,
        percent: complete ? 100 : 0,
        completedAt: complete ? new Date() : null,
        lastViewedAt: new Date(),
      },
      update: {
        percent: complete ? 100 : 0,
        completedAt: complete ? new Date() : null,
        lastViewedAt: new Date(),
      },
    });

    await recomputeProgress(enrollment.id, enrollment.product.course.id, user.id);

    revalidatePath(`/learn/${productId}`);
    return { ok: true };
  } catch (err) {
    console.error('[enrollment]', err instanceof Error ? err.message : err);
    return { error: 'Could not save your progress.' };
  }
}

/**
 * Progress against the course this learner was actually given.
 *
 * A batch that teaches four of six modules must still be able to reach 100%, and
 * a section hidden while it is being written must not hold everyone at 94%. So
 * the denominator is the visible curriculum for this enrolment, not the course
 * in the abstract.
 */
async function recomputeProgress(enrollmentId: string, courseId: string, userId: string) {
  const batchModules = await db.batchModule.findMany({
    where: { batch: { enrollments: { some: { id: enrollmentId } } } },
    select: { moduleId: true },
  });
  const moduleIds = batchModules.map((m) => m.moduleId);

  const scope = {
    section: {
      isVisible: true,
      module: {
        courses: { some: { courseId } },
        ...(moduleIds.length ? { id: { in: moduleIds } } : {}),
      },
    },
  };

  const total = await db.material.count({ where: scope });

  const done = await db.materialProgress.count({
    where: { userId, completedAt: { not: null }, material: scope },
  });

  const progressPercent = total > 0 ? Math.round((done / total) * 100) : 0;

  await db.enrollment.update({
    where: { id: enrollmentId },
    data: {
      progressPercent,
      lastActivityAt: new Date(),
      ...(progressPercent === 100 ? { completedAt: new Date(), status: 'COMPLETED' } : {}),
    },
  });

  // Finishing a course should not depend on someone remembering to press a
  // button. Best effort: it never rolls back the progress that triggered it.
  if (progressPercent === 100) {
    const { autoIssueOnCompletion } = await import('@/server/certificates');
    await autoIssueOnCompletion(enrollmentId);
  }
}
