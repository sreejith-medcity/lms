'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { uniqueSlug } from '@/lib/slug';
import { bundleProblem, wouldLoop } from '@/lib/learning-paths';
import { pathEdges } from '@/lib/learning-paths-data';
import type { ActionState } from '@/server/courses';

/**
 * Learning paths: prerequisites between courses, and bundles.
 *
 * Both are course management. A prerequisite changes who is allowed to buy;
 * a bundle is a product in its own right, so publishing and pricing it go
 * through the same actions as a course (setCourseStatus, addPricingPlan).
 */

async function guard(permission: string, action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[learning-paths]', message);
  return { error: 'Something went wrong. Please try again.' };
}

function refreshStorefront() {
  revalidatePath('/');
  revalidatePath('/courses');
  revalidatePath('/course/[slug]', 'page');
  revalidatePath('/bundle/[slug]', 'page');
}

/* Prerequisites ------------------------------------------------------------- */

const prerequisiteShape = z.object({
  courseId: z.string().min(1),
  requiredCourseId: z.string().min(1, 'Pick the course that comes first.'),
  minProgressPercent: z.coerce.number().int().min(0).max(100),
});

export async function addPrerequisite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('courses.course_management');
    const parsed = prerequisiteShape.safeParse({
      courseId: formData.get('courseId'),
      requiredCourseId: formData.get('requiredCourseId'),
      minProgressPercent: formData.get('minProgressPercent') ?? 100,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const [course, required] = await Promise.all([
      db.course.findFirst({ where: { id: d.courseId, organizationId: tenant.organizationId }, select: { id: true, productId: true } }),
      db.course.findFirst({ where: { id: d.requiredCourseId, organizationId: tenant.organizationId }, select: { id: true, product: { select: { title: true } } } }),
    ]);
    if (!course || !required) return { error: 'Course not found.' };

    const edges = await pathEdges(tenant.organizationId);
    if (wouldLoop(edges, d.courseId, d.requiredCourseId)) {
      return { error: 'That would go round in a circle: the course would need itself, through the others.' };
    }

    await db.coursePrerequisite.upsert({
      where: { courseId_requiredCourseId: { courseId: d.courseId, requiredCourseId: d.requiredCourseId } },
      create: {
        organizationId: tenant.organizationId,
        courseId: d.courseId,
        requiredCourseId: d.requiredCourseId,
        minProgressPercent: d.minProgressPercent,
      },
      update: { minProgressPercent: d.minProgressPercent },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'course.prerequisite_set',
      entity: 'Course',
      entityId: d.courseId,
      after: { requires: required.product.title, minProgressPercent: d.minProgressPercent },
    });

    revalidatePath(`/admin/courses/${course.productId}`);
    refreshStorefront();
    return { ok: true, message: `Needs ${required.product.title} first.` };
  } catch (err) {
    return fail(err);
  }
}

export async function removePrerequisite(courseId: string, requiredCourseId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('courses.course_management');
    const row = await db.coursePrerequisite.findFirst({
      where: { organizationId: tenant.organizationId, courseId, requiredCourseId },
      select: { id: true, course: { select: { productId: true } } },
    });
    if (!row) return { error: 'That prerequisite is already gone.' };
    await db.coursePrerequisite.delete({ where: { id: row.id } });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'course.prerequisite_removed',
      entity: 'Course',
      entityId: courseId,
      after: { requiredCourseId },
    });
    revalidatePath(`/admin/courses/${row.course.productId}`);
    refreshStorefront();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Bundles ------------------------------------------------------------------- */

const bundleShape = z.object({
  id: z.string().optional().or(z.literal('')),
  title: z.string().trim().min(2, 'Give the bundle a name.').max(100),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  thumbnailAssetId: z.string().optional().or(z.literal('')),
  isFeatured: z.boolean(),
});

/** Create or update a bundle: its name, blurb, picture, and the courses in it, in order. */
export async function saveBundle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let created: string | null = null;
  try {
    const { tenant, user } = await guard('courses.course_management');
    const parsed = bundleShape.safeParse({
      id: formData.get('id') ?? '',
      title: formData.get('title'),
      description: formData.get('description') ?? '',
      thumbnailAssetId: formData.get('thumbnailAssetId') ?? '',
      isFeatured: formData.get('isFeatured') === 'on',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    // Course product ids, in the order the form listed them.
    const courseProductIds = formData
      .getAll('courseProductId')
      .map((v) => String(v))
      .filter(Boolean);
    const problem = bundleProblem(d.title, courseProductIds);
    if (problem) return { error: problem };

    const courses = await db.product.findMany({
      where: { id: { in: courseProductIds }, organizationId: tenant.organizationId, type: 'COURSE', deletedAt: null },
      select: { id: true },
    });
    const allowed = new Set(courses.map((c) => c.id));
    const ordered = Array.from(new Set(courseProductIds)).filter((id) => allowed.has(id));
    if (ordered.length < 2) return { error: 'A bundle needs at least two courses.' };

    if (d.id) {
      const product = await db.product.findFirst({
        where: { id: d.id, organizationId: tenant.organizationId, type: 'BUNDLE', deletedAt: null },
        select: { id: true, bundle: { select: { id: true } } },
      });
      if (!product?.bundle) return { error: 'Bundle not found.' };
      const bundleId = product.bundle.id;

      await db.$transaction([
        db.product.update({ where: { id: product.id }, data: { title: d.title, isFeatured: d.isFeatured } }),
        db.bundle.update({
          where: { id: bundleId },
          data: { description: d.description || null, thumbnailAssetId: d.thumbnailAssetId || null },
        }),
        db.bundleItem.deleteMany({ where: { bundleId, productId: { notIn: ordered } } }),
        ...ordered.map((productId, i) =>
          db.bundleItem.upsert({
            where: { bundleId_productId: { bundleId, productId } },
            create: { bundleId, productId, sortOrder: i },
            update: { sortOrder: i },
          }),
        ),
      ]);

      await recordAudit({
        organizationId: tenant.organizationId,
        actorId: user.id,
        action: 'bundle.update',
        entity: 'Product',
        entityId: product.id,
        after: { title: d.title, courses: ordered },
      });

      revalidatePath('/admin/bundles');
      revalidatePath(`/admin/bundles/${product.id}`);
      refreshStorefront();
      return { ok: true, message: 'Saved.' };
    }

    const slug = await uniqueSlug(d.title, async (candidate) => {
      const hit = await db.product.findUnique({
        where: { organizationId_slug: { organizationId: tenant.organizationId, slug: candidate } },
        select: { id: true },
      });
      return hit !== null;
    });

    const product = await db.product.create({
      data: {
        organizationId: tenant.organizationId,
        type: 'BUNDLE',
        title: d.title,
        slug,
        status: 'DRAFT',
        isFeatured: d.isFeatured,
        createdById: user.id,
        bundle: {
          create: {
            organizationId: tenant.organizationId,
            description: d.description || null,
            thumbnailAssetId: d.thumbnailAssetId || null,
            items: { create: ordered.map((productId, i) => ({ productId, sortOrder: i })) },
          },
        },
      },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'bundle.create',
      entity: 'Product',
      entityId: product.id,
      after: { title: d.title, slug, courses: ordered },
    });
    created = product.id;
  } catch (err) {
    return fail(err);
  }

  revalidatePath('/admin/bundles');
  redirect(`/admin/bundles/${created}`);
}

/** A bundle nobody has bought can go; one that has been sold is unpublished instead. */
export async function deleteBundle(productId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('courses.course_management', 'delete');
    const product = await db.product.findFirst({
      where: { id: productId, organizationId: tenant.organizationId, type: 'BUNDLE', deletedAt: null },
      select: { id: true, title: true, _count: { select: { orderItems: true, cartItems: true } } },
    });
    if (!product) return { error: 'Bundle not found.' };
    if (product._count.orderItems > 0) {
      await db.product.update({ where: { id: product.id }, data: { status: 'UNPUBLISHED', deletedAt: new Date() } });
    } else {
      await db.cartItem.deleteMany({ where: { productId: product.id } });
      await db.pricingPlan.deleteMany({ where: { productId: product.id } });
      await db.product.delete({ where: { id: product.id } });
    }
    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'bundle.delete',
      entity: 'Product',
      entityId: product.id,
      after: { title: product.title, sold: product._count.orderItems },
    });
    revalidatePath('/admin/bundles');
    refreshStorefront();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
