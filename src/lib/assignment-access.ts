import { db } from '@/lib/db';

/**
 * Which assignments a learner has, and whether one is theirs.
 *
 * An assignment is set for a course, or for one batch of it. A learner has
 * it when they hold a live enrolment in that course and, where the
 * assignment names a batch, when that enrolment is in that batch. Decided
 * once here so the list, the page, the hand-in and the file route cannot
 * disagree about who may see what.
 */

/** Registered but unpaid, expired, cancelled and archived enrolments carry no homework. */
const LIVE = ['ENROLLED', 'ON_LEAVE', 'COMPLETED'] as const;

export async function learnerEnrolments(organizationId: string, userId: string) {
  return db.enrollment.findMany({
    where: { organizationId, userId, status: { in: [...LIVE] } },
    select: {
      id: true,
      batchId: true,
      product: { select: { id: true, title: true, course: { select: { id: true } } } },
    },
  });
}

/** The where-clause for every published assignment this learner should see. */
export function assignmentsWhereFor(enrolments: Awaited<ReturnType<typeof learnerEnrolments>>) {
  const clauses = enrolments
    .filter((e) => e.product.course)
    .map((e) => ({
      courseId: e.product.course!.id,
      OR: [{ batchId: null }, ...(e.batchId ? [{ batchId: e.batchId }] : [])],
    }));
  return clauses;
}

/** The enrolment through which this learner holds this assignment, or null. */
export async function enrolmentFor(
  organizationId: string,
  userId: string,
  assignment: { courseId: string; batchId: string | null },
): Promise<{ id: string; productId: string; batchId: string | null } | null> {
  const enrolments = await learnerEnrolments(organizationId, userId);
  const match = enrolments.find(
    (e) => e.product.course?.id === assignment.courseId && (assignment.batchId === null || e.batchId === assignment.batchId),
  );
  return match ? { id: match.id, productId: match.product.id, batchId: match.batchId } : null;
}
