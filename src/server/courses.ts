'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { slugify, uniqueSlug } from '@/lib/slug';
import { toPaise } from '@/lib/money';
import { recordAudit } from '@/lib/audit';

export interface ActionState {
  error?: string;
  ok?: boolean;
  /** Optional success text, when "saved" is not specific enough to be useful. */
  message?: string;
}

/** Every action runs this first: tenant scope plus the permission the screen claims. */
async function guard(permission: string, action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[courses]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const courseCreate = z.object({
  title: z.string().trim().min(3, 'Give the course a name of at least 3 characters').max(100),
  description: z.string().trim().max(2000).optional(),
  categoryId: z.string().trim().optional(),
});

export async function createCourse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let newId: string;

  try {
    const { tenant, user } = await guard('courses.course_management');

    const parsed = courseCreate.safeParse({
      title: formData.get('title'),
      description: formData.get('description') || undefined,
      categoryId: formData.get('categoryId') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const { title, description, categoryId } = parsed.data;

    const slug = await uniqueSlug(title, async (candidate) => {
      const hit = await db.product.findUnique({
        where: { organizationId_slug: { organizationId: tenant.organizationId, slug: candidate } },
        select: { id: true },
      });
      return hit !== null;
    });

    const product = await db.product.create({
      data: {
        organizationId: tenant.organizationId,
        type: 'COURSE',
        title,
        slug,
        status: 'DRAFT',
        course: {
          create: {
            organizationId: tenant.organizationId,
            description,
            prettyName: slugify(title),
            ...(categoryId
              ? { categories: { create: { categoryId } } }
              : {}),
          },
        },
      },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'course.create',
      entity: 'Product',
      entityId: product.id,
      after: { title, slug },
    });

    newId = product.id;
  } catch (err) {
    return fail(err);
  }

  revalidatePath('/admin/courses');
  redirect(`/admin/courses/${newId}`);
}

const courseUpdate = z.object({
  productId: z.string().min(1),
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().max(2000).optional(),
  level: z.string().trim().max(50).optional(),
  language: z.string().trim().max(50).optional(),
  promoVideoUrl: z.string().trim().url('Promo video must be a full URL').optional().or(z.literal('')),
  modulesArePrerequisite: z.boolean(),
  learnerCanComplete: z.boolean(),
  milestoneCelebrations: z.boolean(),
  accessAfterCompletion: z.boolean(),
});

export async function updateCourse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('courses.course_management');

    const parsed = courseUpdate.safeParse({
      productId: formData.get('productId'),
      title: formData.get('title'),
      description: formData.get('description') || undefined,
      level: formData.get('level') || undefined,
      language: formData.get('language') || undefined,
      promoVideoUrl: formData.get('promoVideoUrl') || '',
      modulesArePrerequisite: formData.get('modulesArePrerequisite') === 'on',
      learnerCanComplete: formData.get('learnerCanComplete') === 'on',
      milestoneCelebrations: formData.get('milestoneCelebrations') === 'on',
      accessAfterCompletion: formData.get('accessAfterCompletion') === 'on',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const product = await db.product.findFirst({
      where: { id: d.productId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!product) return { error: 'Course not found.' };

    await db.product.update({
      where: { id: d.productId },
      data: {
        title: d.title,
        course: {
          update: {
            description: d.description,
            level: d.level,
            language: d.language,
            promoVideoUrl: d.promoVideoUrl || null,
            modulesArePrerequisite: d.modulesArePrerequisite,
            learnerCanComplete: d.learnerCanComplete,
            milestoneCelebrations: d.milestoneCelebrations,
            accessAfterCompletion: d.accessAfterCompletion,
          },
        },
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'course.update',
      entity: 'Product',
      entityId: d.productId,
      after: { title: d.title, level: d.level, language: d.language },
    });

    revalidatePath(`/admin/courses/${d.productId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setCourseStatus(productId: string, publish: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('courses.pricing_and_publish');

    const product = await db.product.findFirst({
      where: { id: productId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!product) return { error: 'Course not found.' };

    await db.product.update({
      where: { id: productId },
      data: { status: publish ? 'PUBLISHED' : 'UNPUBLISHED' },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: publish ? 'course.publish' : 'course.unpublish',
      entity: 'Product',
      entityId: productId,
      after: { status: publish ? 'PUBLISHED' : 'UNPUBLISHED' },
    });

    revalidatePath(`/admin/courses/${productId}`);
    revalidatePath('/admin/courses');
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const pricingPlan = z.object({
  productId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  priceRupees: z.coerce.number().min(0),
  mrpRupees: z.coerce.number().min(0).optional(),
  validityDays: z.coerce.number().int().min(0).optional(),
});

export async function addPricingPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('courses.pricing_and_publish');

    const parsed = pricingPlan.safeParse({
      productId: formData.get('productId'),
      name: formData.get('name'),
      priceRupees: formData.get('priceRupees'),
      mrpRupees: formData.get('mrpRupees') || undefined,
      validityDays: formData.get('validityDays') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const product = await db.product.findFirst({
      where: { id: d.productId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!product) return { error: 'Course not found.' };

    const branch = await db.branch.findFirst({
      where: { organizationId: tenant.organizationId, isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    await db.pricingPlan.create({
      data: {
        productId: d.productId,
        branchId: branch?.id,
        name: d.name,
        planType: d.priceRupees === 0 ? 'FREE' : 'ONE_TIME',
        currency: tenant.currency,
        pricePaise: toPaise(d.priceRupees),
        mrpPaise: d.mrpRupees ? toPaise(d.mrpRupees) : null,
        validityDays: d.validityDays || null,
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'pricing.create',
      entity: 'PricingPlan',
      entityId: d.productId,
      after: { name: d.name, pricePaise: toPaise(d.priceRupees), currency: tenant.currency },
    });

    revalidatePath(`/admin/courses/${d.productId}/pricing`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deletePricingPlan(planId: string, productId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('courses.pricing_and_publish', 'delete');

    const plan = await db.pricingPlan.findFirst({
      where: { id: planId, product: { organizationId: tenant.organizationId } },
      select: { id: true, _count: { select: { enrollments: true } } },
    });
    if (!plan) return { error: 'Plan not found.' };

    // A plan someone bought on is history, not a row to delete.
    if (plan._count.enrollments > 0) {
      await db.pricingPlan.update({ where: { id: planId }, data: { isActive: false } });
    } else {
      await db.pricingPlan.delete({ where: { id: planId } });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: plan._count.enrollments > 0 ? 'pricing.deactivate' : 'pricing.delete',
      entity: 'PricingPlan',
      entityId: planId,
      before: { productId },
    });

    revalidatePath(`/admin/courses/${productId}/pricing`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
