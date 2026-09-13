import { db } from '@/lib/db';
import { blockedMessage, checkPrerequisites, type Prerequisite } from '@/lib/learning-paths';

/**
 * Learning paths against the database: what a course asks for, how far a
 * learner has got, and whether a purchase should be refused.
 */

export interface PrerequisiteRow extends Prerequisite {
  requiredSlug: string;
  requiredPublished: boolean;
}

export async function prerequisitesFor(organizationId: string, courseId: string): Promise<PrerequisiteRow[]> {
  const rows = await db.coursePrerequisite.findMany({
    where: { organizationId, courseId },
    orderBy: { createdAt: 'asc' },
    select: {
      requiredCourseId: true,
      minProgressPercent: true,
      required: { select: { product: { select: { title: true, slug: true, status: true } } } },
    },
  });
  return rows.map((r) => ({
    requiredCourseId: r.requiredCourseId,
    requiredTitle: r.required.product.title,
    requiredSlug: r.required.product.slug,
    requiredPublished: r.required.product.status === 'PUBLISHED',
    minProgressPercent: r.minProgressPercent,
  }));
}

/** The furthest this learner has got in each course, or null where they are not enrolled. */
export async function progressOf(
  organizationId: string,
  userId: string,
  courseIds: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(courseIds.map((id) => [id, null]));
  if (courseIds.length === 0) return out;
  const rows = await db.enrollment.findMany({
    where: {
      organizationId,
      userId,
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      product: { course: { id: { in: courseIds } } },
    },
    select: { progressPercent: true, status: true, product: { select: { course: { select: { id: true } } } } },
  });
  for (const r of rows) {
    const id = r.product.course?.id;
    if (!id) continue;
    // A completed enrolment counts as finished whatever the percent says.
    const have = r.status === 'COMPLETED' ? 100 : r.progressPercent;
    out.set(id, Math.max(out.get(id) ?? 0, have));
  }
  return out;
}

/**
 * Why this learner may not buy these products yet, or null. Checks every
 * course in the list (a bundle's courses included), and answers with the
 * first one in the way.
 */
export async function prerequisiteBlock(
  organizationId: string,
  userId: string,
  productIds: string[],
): Promise<string | null> {
  if (productIds.length === 0) return null;
  const products = await db.product.findMany({
    where: { id: { in: productIds }, organizationId },
    select: {
      title: true,
      course: { select: { id: true } },
      bundle: { select: { items: { select: { product: { select: { title: true, course: { select: { id: true } } } } } } } },
    },
  });
  const courses: { title: string; courseId: string }[] = [];
  for (const p of products) {
    if (p.course) courses.push({ title: p.title, courseId: p.course.id });
    for (const item of p.bundle?.items ?? []) {
      if (item.product.course) courses.push({ title: item.product.title, courseId: item.product.course.id });
    }
  }
  for (const c of courses) {
    const prerequisites = await prerequisitesFor(organizationId, c.courseId);
    if (prerequisites.length === 0) continue;
    // What you are buying now can satisfy what else you are buying now only
    // once it is done, so nothing in the basket counts as progress.
    const progress = await progressOf(organizationId, userId, prerequisites.map((p) => p.requiredCourseId));
    const message = blockedMessage(checkPrerequisites(prerequisites, progress));
    if (message) return courses.length > 1 ? `${c.title}: ${message}` : message;
  }
  return null;
}

/** Every prerequisite edge in the academy, for drawing a path. */
export async function pathEdges(organizationId: string) {
  return db.coursePrerequisite.findMany({
    where: { organizationId },
    select: { courseId: true, requiredCourseId: true },
  });
}
