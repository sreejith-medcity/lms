'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
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
  prettyName: z.string().trim().max(120).optional().or(z.literal('')),
  durationMinutes: z.coerce.number().min(0).max(2000).optional(),
  thumbnailAssetId: z.string().optional().or(z.literal('')),
  overviewLinkOverride: z.string().trim().url('That is not a full URL').optional().or(z.literal('')),
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
      prettyName: formData.get('prettyName') || '',
      durationMinutes: formData.get('durationHours') || undefined,
      thumbnailAssetId: formData.get('thumbnailAssetId') || '',
      overviewLinkOverride: formData.get('overviewLinkOverride') || '',
      modulesArePrerequisite: formData.get('modulesArePrerequisite') === 'on',
      learnerCanComplete: formData.get('learnerCanComplete') === 'on',
      milestoneCelebrations: formData.get('milestoneCelebrations') === 'on',
      accessAfterCompletion: formData.get('accessAfterCompletion') === 'on',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    // Overview blocks arrive as parallel arrays with a weight each, which is how
    // Edmingle orders the sections of a course page.
    const headings = formData.getAll('blockHeading').map((v) => String(v).trim());
    const bodies = formData.getAll('blockBody').map((v) => String(v).trim());
    const weights = formData.getAll('blockWeight').map((v) => Number(v) || 0);
    const overviewBlocks = headings
      .map((heading, i) => ({ heading, body: bodies[i] ?? '', weight: weights[i] ?? i }))
      .filter((b) => b.heading || b.body)
      .sort((a, b) => a.weight - b.weight);

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
            prettyName: d.prettyName || null,
            // Entered in hours because that is how a curriculum is discussed,
            // stored in minutes because that is how it is summed.
            durationMinutes: d.durationMinutes ? Math.round(d.durationMinutes * 60) : null,
            thumbnailAssetId: d.thumbnailAssetId || null,
            overviewLinkOverride: d.overviewLinkOverride || null,
            overviewBlocks: overviewBlocks as Prisma.InputJsonValue,
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
  branchId: z.string().trim().optional(),
  planType: z.enum(['ONE_TIME', 'INSTALMENT', 'SUBSCRIPTION', 'FREE']).optional(),
  instalmentCount: z.coerce.number().int().min(1).max(24).optional(),
  instalmentGapDays: z.coerce.number().int().min(1).max(365).optional(),
  invoiceAnchor: z.enum(['CLASS_COMMENCEMENT', 'ENROLLMENT']).optional(),
});

/**
 * Instalments as a schedule, not a count.
 *
 * The count alone leaves the office guessing when each part is due, so we write
 * out the actual dues and give the remainder to the first payment: a fee of
 * 10,000 in three parts is 3,334 + 3,333 + 3,333, never 3,333.33 three times
 * and a rupee nobody can collect.
 */
function instalmentSchedule(totalPaise: number, count: number, gapDays: number) {
  const each = Math.floor(totalPaise / count);
  const remainder = totalPaise - each * count;
  return Array.from({ length: count }, (_, i) => ({
    dueOffsetDays: i * gapDays,
    amountPaise: i === 0 ? each + remainder : each,
  }));
}

export async function addPricingPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('courses.pricing_and_publish');

    const parsed = pricingPlan.safeParse({
      productId: formData.get('productId'),
      name: formData.get('name'),
      priceRupees: formData.get('priceRupees'),
      mrpRupees: formData.get('mrpRupees') || undefined,
      validityDays: formData.get('validityDays') || undefined,
      branchId: formData.get('branchId') || undefined,
      planType: formData.get('planType') || undefined,
      instalmentCount: formData.get('instalmentCount') || undefined,
      instalmentGapDays: formData.get('instalmentGapDays') || undefined,
      invoiceAnchor: formData.get('invoiceAnchor') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const product = await db.product.findFirst({
      where: { id: d.productId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!product) return { error: 'Course not found.' };

    // A blank branch means every branch, which is what most courses want.
    const branchId = d.branchId
      ? (
          await db.branch.findFirst({
            where: { id: d.branchId, organizationId: tenant.organizationId },
            select: { id: true },
          })
        )?.id ?? null
      : null;
    if (d.branchId && !branchId) return { error: 'That branch does not exist.' };

    const pricePaise = toPaise(d.priceRupees);
    const mrpPaise = d.mrpRupees ? toPaise(d.mrpRupees) : null;
    if (mrpPaise !== null && mrpPaise < pricePaise) {
      return { error: 'The struck-through price is below the price, which reads as a price rise.' };
    }

    const planType =
      pricePaise === 0 ? 'FREE' : (d.planType && d.planType !== 'FREE' ? d.planType : 'ONE_TIME');

    const instalmentCount = planType === 'INSTALMENT' ? d.instalmentCount ?? 2 : 1;
    if (planType === 'INSTALMENT' && instalmentCount < 2) {
      return { error: 'An instalment plan needs at least two payments.' };
    }

    await db.pricingPlan.create({
      data: {
        productId: d.productId,
        branchId,
        name: d.name,
        planType,
        currency: tenant.currency,
        pricePaise,
        mrpPaise,
        validityDays: d.validityDays || null,
        instalmentCount,
        instalmentPlan:
          planType === 'INSTALMENT'
            ? instalmentSchedule(pricePaise, instalmentCount, d.instalmentGapDays ?? 30)
            : undefined,
        invoiceAnchor: d.invoiceAnchor ?? 'CLASS_COMMENCEMENT',
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

/* Publishing and drip ------------------------------------------------------ */

/**
 * Which channels a course appears on, and how it is sold.
 *
 * Kept apart from the details form because these are the switches that change
 * whether anybody can buy the thing, and mixing them into a form about wording
 * makes them easy to flip by accident.
 */
export async function updatePublishing(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('courses.pricing_and_publish');

    const productId = String(formData.get('productId') ?? '');
    const product = await db.product.findFirst({
      where: { id: productId, organizationId: tenant.organizationId },
      select: { id: true, status: true },
    });
    if (!product) return { error: 'Course not found.' };

    const onDemandOnly = formData.get('onDemandOnly') === 'on';
    const publishWeb = formData.get('publishWeb') === 'on';

    if (product.status === 'PUBLISHED' && !publishWeb && !onDemandOnly) {
      return {
        error:
          'A published course that is off the web and not admin-only is reachable by nobody. Turn one of them on.',
      };
    }

    await db.product.update({
      where: { id: productId },
      data: {
        isFeatured: formData.get('isFeatured') === 'on',
        course: {
          update: {
            publishWeb,
            publishAndroid: formData.get('publishAndroid') === 'on',
            publishIos: formData.get('publishIos') === 'on',
            freePreviewEnabled: formData.get('freePreviewEnabled') === 'on',
            onDemandOnly,
            appleIapProductId: String(formData.get('appleIapProductId') ?? '').trim() || null,
          },
        },
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'course.publishing.updated',
      entity: 'Product',
      entityId: productId,
      after: { publishWeb, onDemandOnly },
    });

    revalidatePath(`/admin/courses/${productId}/pricing`);
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Drip: when a lesson becomes available.
 *
 * Three anchors, because academies genuinely mean three different things by
 * "week two". Relative to when the learner enrolled, relative to when the batch
 * started, or a fixed date for everyone.
 */
export async function setDripRule(
  productId: string,
  materialId: string,
  anchor: 'ENROLLMENT_DATE' | 'BATCH_START_DATE' | 'SPECIFIC_DATE' | 'NONE',
  offsetDays: number,
  releaseAt: string | null,
): Promise<ActionState> {
  try {
    const { tenant } = await guard('module.drip');

    const material = await db.material.findFirst({
      where: { id: materialId, section: { module: { organizationId: tenant.organizationId } } },
      select: { id: true },
    });
    if (!material) return { error: 'Lesson not found.' };

    const course = await db.product.findFirst({
      where: { id: productId, organizationId: tenant.organizationId },
      select: { course: { select: { id: true } } },
    });
    if (!course?.course) return { error: 'Course not found.' };

    await db.dripRule.deleteMany({ where: { courseId: course.course.id, materialId } });

    if (anchor !== 'NONE') {
      if (anchor === 'SPECIFIC_DATE' && !releaseAt) {
        return { error: 'Pick the date it opens.' };
      }

      await db.dripRule.create({
        data: {
          courseId: course.course.id,
          materialId,
          anchor,
          offsetDays: anchor === 'SPECIFIC_DATE' ? 0 : Math.max(0, Math.round(offsetDays)),
          releaseAt: anchor === 'SPECIFIC_DATE' && releaseAt ? new Date(releaseAt) : null,
        },
      });
    }

    revalidatePath(`/admin/courses/${productId}/drip`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
