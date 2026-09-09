'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { hashPassword } from '@/lib/password';
import { recordAudit } from '@/lib/audit';
import { computeTax } from '@/lib/money';
import type { ActionState } from '@/server/courses';

/**
 * Enrolling someone by hand.
 *
 * Every academy needs this: a learner pays at the counter, a scholarship is
 * granted, a stuck online payment has to be honoured. What matters is that a
 * manual enrolment is never indistinguishable from a self-service one. The
 * enrolment records who did it and why, and money taken offline is written as a
 * real order and payment rather than granted invisibly, so the collections
 * figure on the dashboard stays true.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('new_enrollment.single', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to enrol learners.' };
  console.error('[enrolments]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const enrolment = z.object({
  userId: z.string().optional().or(z.literal('')),
  name: z.string().trim().max(120).optional().or(z.literal('')),
  email: z.string().trim().email('That email address does not look right').optional().or(z.literal('')),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  productId: z.string().min(1, 'Pick a course'),
  batchId: z.string().optional().or(z.literal('')),
  pricingPlanId: z.string().optional().or(z.literal('')),
  payment: z.enum(['NONE', 'CASH', 'CHEQUE', 'BANK', 'ALREADY_PAID']),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

export async function enrolManually(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { temporaryPassword?: string }> {
  try {
    const { tenant, user: actor } = await guard();

    const parsed = enrolment.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const product = await db.product.findFirst({
      where: { id: d.productId, organizationId: tenant.organizationId, deletedAt: null },
      select: {
        id: true,
        title: true,
        course: { select: { id: true } },
        pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!product?.course) return { error: 'Course not found.' };

    const branch = await db.branch.findFirst({
      where: { organizationId: tenant.organizationId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) return { error: 'This academy has no active branch.' };

    /* The learner: an existing account, or a new one. */
    let userId = d.userId || '';
    let temporaryPassword: string | undefined;

    if (!userId) {
      if (!d.name || (!d.email && !d.phone)) {
        return { error: 'Pick an existing learner, or give a name and an email or phone number.' };
      }

      const email = d.email ? d.email.toLowerCase() : null;

      const clash = email
        ? await db.user.findFirst({
            where: { organizationId: tenant.organizationId, email, deletedAt: null },
            select: { id: true },
          })
        : null;

      if (clash) {
        userId = clash.id;
      } else {
        temporaryPassword = `${randomBytes(6).toString('base64url')}-${randomBytes(2).toString('hex')}`;

        const last = await db.user.aggregate({
          where: { organizationId: tenant.organizationId },
          _max: { registrationNo: true },
        });

        const created = await db.user.create({
          data: {
            organizationId: tenant.organizationId,
            name: d.name,
            email,
            phone: d.phone || null,
            kind: 'LEARNER',
            status: 'ACTIVE',
            passwordHash: await hashPassword(temporaryPassword),
            mustResetPassword: true,
            registrationNo: (last._max.registrationNo ?? 0) + 1,
            branchMemberships: { create: { branchId: branch.id, isPrimary: true } },
          },
          select: { id: true },
        });
        userId = created.id;
      }
    }

    const owned = await db.user.findFirst({
      where: { id: userId, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!owned) return { error: 'Learner not found.' };

    /* The batch. */
    const batch = d.batchId
      ? await db.batch.findFirst({
          where: { id: d.batchId, organizationId: tenant.organizationId, deletedAt: null },
          select: { id: true },
        })
      : await db.batch.findFirst({
          where: {
            courseId: product.course.id,
            status: { in: ['ACTIVE', 'UPCOMING'] },
            deletedAt: null,
          },
          orderBy: [{ isDefault: 'desc' }, { startDate: 'asc' }],
          select: { id: true },
        });

    const existing = await db.enrollment.findFirst({
      where: {
        userId,
        productId: product.id,
        batchId: batch?.id ?? null,
        status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      },
      select: { id: true },
    });
    if (existing) return { error: `${owned.name} is already enrolled in this course.` };

    const plan =
      product.pricingPlans.find((p) => p.id === d.pricingPlanId) ?? product.pricingPlans[0];

    /* Money taken offline becomes a real order and payment, not a silent grant. */
    let orderItemId: string | null = null;

    if (d.payment !== 'NONE' && plan && plan.pricePaise > 0) {
      const taxConfig = await db.taxConfig.findFirst({
        where: { organizationId: tenant.organizationId },
      });

      const tax = computeTax({
        amountPaise: plan.pricePaise,
        cgstPercent: taxConfig?.cgstPercent ?? 9,
        sgstPercent: taxConfig?.sgstPercent ?? 9,
        igstPercent: taxConfig?.igstPercent ?? 18,
        interState: false,
        pricesAreExclusive: taxConfig?.pricesAreExclusive ?? true,
      });

      const enabled = taxConfig?.enabled ?? true;
      const totalPaise = enabled ? tax.totalPaise : plan.pricePaise;
      const taxPaise = enabled ? tax.totalPaise - tax.taxablePaise : 0;

      const count = await db.order.count({ where: { organizationId: tenant.organizationId } });
      const invoiceCount = await db.invoice.count({
        where: { order: { organizationId: tenant.organizationId } },
      });
      const year = new Date().getFullYear();

      const order = await db.order.create({
        data: {
          organizationId: tenant.organizationId,
          branchId: branch.id,
          userId,
          orderNo: `ORD-${year}-${String(count + 1).padStart(5, '0')}`,
          status: 'PAID',
          currency: plan.currency,
          subtotalPaise: plan.pricePaise,
          taxPaise,
          totalPaise,
          items: {
            create: {
              productId: product.id,
              pricingPlanId: plan.id,
              titleSnapshot: product.title,
              pricePaise: plan.pricePaise,
              taxPaise,
              totalPaise,
            },
          },
          payments: {
            create: {
              organizationId: tenant.organizationId,
              userId,
              gateway: d.payment === 'ALREADY_PAID' ? 'MANUAL' : d.payment,
              method: d.payment.toLowerCase(),
              amountPaise: totalPaise,
              currency: plan.currency,
              status: 'CAPTURED',
              capturedAt: new Date(),
              raw: { recordedBy: actor.id, note: d.note || null },
            },
          },
          invoice: {
            create: {
              invoiceNo: `INV-${year}-${String(invoiceCount + 1).padStart(5, '0')}`,
              taxBreakup: {
                taxableValue: plan.pricePaise,
                cgst: enabled ? Math.round((plan.pricePaise * (taxConfig?.cgstPercent ?? 9)) / 100) : 0,
                sgst: enabled ? Math.round((plan.pricePaise * (taxConfig?.sgstPercent ?? 9)) / 100) : 0,
                igst: 0,
                total: totalPaise,
              },
              placeOfSupply: taxConfig?.state ?? null,
            },
          },
        },
        select: { id: true, orderNo: true, items: { select: { id: true } } },
      });

      orderItemId = order.items[0]?.id ?? null;
    }

    const enrollment = await db.enrollment.create({
      data: {
        organizationId: tenant.organizationId,
        branchId: branch.id,
        userId,
        productId: product.id,
        batchId: batch?.id,
        pricingPlanId: plan?.id,
        orderItemId,
        status: 'ENROLLED',
        source: 'ADMIN_SINGLE',
        startsAt: new Date(),
        expiresAt: plan?.validityDays ? new Date(Date.now() + plan.validityDays * 864e5) : null,
      },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: actor.id,
      action: 'enrolment.manual',
      entity: 'Enrollment',
      entityId: enrollment.id,
      after: {
        learner: owned.name,
        course: product.title,
        payment: d.payment,
        note: d.note || null,
        newAccount: Boolean(temporaryPassword),
      },
    });

    revalidatePath('/admin/enrol');
    revalidatePath('/admin/learners');

    return {
      ok: true,
      temporaryPassword,
      message: temporaryPassword
        ? `${owned.name} is enrolled. They have a new account with the one-time password below.`
        : `${owned.name} is enrolled in ${product.title}.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/* Batches ----------------------------------------------------------------- */

const batch = z.object({
  courseId: z.string().min(1, 'Pick a course'),
  branchId: z.string().min(1, 'Pick a branch'),
  name: z.string().trim().min(2, 'Give the batch a name').max(120),
  startDate: z.string().optional().or(z.literal('')),
  endDate: z.string().optional().or(z.literal('')),
  capacity: z.coerce.number().min(0).max(10000).optional(),
  isDefault: z.boolean(),
});

export async function createBatch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const [tenant, user] = await Promise.all([
      requireTenant(),
      requireStaff('batches.batch_management', 'edit'),
    ]);

    const parsed = batch.safeParse({
      courseId: formData.get('courseId'),
      branchId: formData.get('branchId'),
      name: formData.get('name'),
      startDate: formData.get('startDate') || '',
      endDate: formData.get('endDate') || '',
      capacity: formData.get('capacity') || 0,
      isDefault: formData.get('isDefault') === 'on',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const course = await db.course.findFirst({
      where: { id: d.courseId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!course) return { error: 'Course not found.' };

    const start = d.startDate ? new Date(d.startDate) : null;
    const end = d.endDate ? new Date(d.endDate) : null;
    if (start && end && end < start) return { error: 'The end date is before the start date.' };

    // Only one default per course, since it is what enrolment falls back to.
    if (d.isDefault) {
      await db.batch.updateMany({
        where: { courseId: d.courseId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const created = await db.batch.create({
      data: {
        organizationId: tenant.organizationId,
        branchId: d.branchId,
        courseId: d.courseId,
        name: d.name,
        startDate: start,
        endDate: end,
        capacity: d.capacity || null,
        isDefault: d.isDefault,
        status: start && start > new Date() ? 'UPCOMING' : 'ACTIVE',
      },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'batch.created',
      entity: 'Batch',
      entityId: created.id,
      after: { name: d.name },
    });

    revalidatePath('/admin/batches');
    return { ok: true, message: 'Batch created. Schedule its classes next.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setBatchStatus(
  batchId: string,
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED',
): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    await requireStaff('batches.batch_management', 'edit');

    await db.batch.updateMany({
      where: { id: batchId, organizationId: tenant.organizationId },
      data: { status },
    });

    revalidatePath('/admin/batches');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
