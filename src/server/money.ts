'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import type { Prisma } from '@prisma/client';
import type { ActionState } from '@/server/courses';

/**
 * Fee plans and refund bookkeeping.
 *
 * One thing this deliberately does not do: move money. Refunds are issued in the
 * Razorpay dashboard, where the controls and the audit trail already exist and
 * where a mistaken click is caught by their confirmation rather than ours. The
 * webhook brings the result back. What is here is the offline half: a cash
 * refund handed across a counter still has to be written down, or the
 * collections figure quietly overstates itself forever.
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
  console.error('[money]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/* Instalments ------------------------------------------------------------- */

const plan = z.object({
  enrollmentId: z.string().min(1),
  count: z.coerce.number().min(2, 'Two or more instalments').max(24),
  firstDue: z.string().min(1, 'Pick a first due date'),
  intervalDays: z.coerce.number().min(7).max(180),
  totalRupees: z.coerce.number().min(1, 'Enter the total'),
});

/**
 * Splits a fee into instalments. The remainder lands on the first one rather
 * than being spread as fractions of a paisa, so the parts always add back up to
 * the total exactly.
 */
export async function createInstalmentPlan(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking');

    const parsed = plan.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const enrollment = await db.enrollment.findFirst({
      where: { id: d.enrollmentId, organizationId: tenant.organizationId },
      select: { id: true, user: { select: { name: true } }, _count: { select: { instalments: true } } },
    });
    if (!enrollment) return { error: 'Enrolment not found.' };
    if (enrollment._count.instalments > 0) {
      return { error: 'This enrolment already has a fee plan.' };
    }

    const total = Math.round(d.totalRupees * 100);
    const each = Math.floor(total / d.count);
    const remainder = total - each * d.count;

    const first = new Date(d.firstDue);

    await db.instalment.createMany({
      data: Array.from({ length: d.count }, (_, i) => {
        const due = new Date(first);
        due.setDate(due.getDate() + i * d.intervalDays);
        return {
          enrollmentId: d.enrollmentId,
          sequence: i + 1,
          amountPaise: i === 0 ? each + remainder : each,
          dueDate: due,
        };
      }),
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'fee.plan.created',
      entity: 'Enrollment',
      entityId: d.enrollmentId,
      after: { learner: enrollment.user.name, count: d.count, totalPaise: total },
    });

    revalidatePath('/admin/fees');
    return { ok: true, message: `${d.count} instalments scheduled.` };
  } catch (err) {
    return fail(err);
  }
}

export async function markInstalmentPaid(
  instalmentId: string,
  method: string,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking');

    const instalment = await db.instalment.findFirst({
      where: { id: instalmentId, enrollment: { organizationId: tenant.organizationId } },
      select: {
        id: true,
        amountPaise: true,
        paidAt: true,
        sequence: true,
        enrollment: { select: { userId: true, branchId: true, user: { select: { name: true } } } },
      },
    });
    if (!instalment) return { error: 'Instalment not found.' };
    if (instalment.paidAt) return { error: 'Already marked paid.' };

    // A collected instalment is a payment. Recording it any other way would
    // leave the collections figure short.
    const payment = await db.payment.create({
      data: {
        organizationId: tenant.organizationId,
        userId: instalment.enrollment.userId,
        gateway: method === 'CASH' ? 'CASH' : 'MANUAL',
        method: method.toLowerCase(),
        amountPaise: instalment.amountPaise,
        status: 'CAPTURED',
        capturedAt: new Date(),
        raw: { instalment: instalment.sequence, recordedBy: user.id } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    await db.instalment.update({
      where: { id: instalmentId },
      data: { paidAt: new Date(), paymentId: payment.id },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'fee.instalment.paid',
      entity: 'Instalment',
      entityId: instalmentId,
      after: {
        learner: instalment.enrollment.user.name,
        amountPaise: instalment.amountPaise,
        method,
      },
    });

    revalidatePath('/admin/fees');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Refunds ----------------------------------------------------------------- */

const refund = z.object({
  paymentId: z.string().min(1),
  amountRupees: z.coerce.number().min(1, 'Enter the amount refunded'),
  reason: z.string().trim().min(3, 'Say why').max(300),
});

/**
 * Records a refund that happened outside the gateway: cash back at the counter,
 * a bank transfer, a cheque. It moves no money. Gateway refunds arrive on their
 * own through the webhook and are not entered here.
 */
export async function recordOfflineRefund(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('sales.refunds');

    const parsed = refund.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const amountPaise = Math.round(d.amountRupees * 100);

    const payment = await db.payment.findFirst({
      where: { id: d.paymentId, organizationId: tenant.organizationId },
      select: {
        id: true,
        amountPaise: true,
        gateway: true,
        status: true,
        orderId: true,
        refunds: { select: { amountPaise: true } },
      },
    });
    if (!payment) return { error: 'Payment not found.' };

    if (payment.gateway === 'RAZORPAY') {
      return {
        error:
          'This was taken through Razorpay. Refund it in the Razorpay dashboard and the webhook will record it here.',
      };
    }

    const already = payment.refunds.reduce((n, r) => n + r.amountPaise, 0);
    if (already + amountPaise > payment.amountPaise) {
      return { error: 'That is more than what is left on this payment.' };
    }

    const full = already + amountPaise >= payment.amountPaise;

    await db.$transaction([
      db.refund.create({
        data: {
          paymentId: payment.id,
          amountPaise,
          reason: d.reason,
          status: 'PROCESSED',
        },
      }),
      db.payment.update({
        where: { id: payment.id },
        data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      }),
    ]);

    if (full && payment.orderId) {
      const items = await db.orderItem.findMany({
        where: { orderId: payment.orderId },
        select: { id: true },
      });

      await db.order.update({ where: { id: payment.orderId }, data: { status: 'REFUNDED' } });

      // Access ends; progress and attendance stay exactly where they are.
      await db.enrollment.updateMany({
        where: { orderItemId: { in: items.map((i) => i.id) }, status: 'ENROLLED' },
        data: { status: 'EXPIRED', expiresAt: new Date() },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'refund.offline.recorded',
      entity: 'Payment',
      entityId: payment.id,
      after: { amountPaise, reason: d.reason, full },
    });

    revalidatePath('/admin/refunds');
    revalidatePath('/admin/payments');
    return { ok: true, message: full ? 'Recorded. Access has ended.' : 'Partial refund recorded.' };
  } catch (err) {
    return fail(err);
  }
}
