import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import type { Prisma } from '@prisma/client';

/**
 * The one place a payment becomes access.
 *
 * Both the browser callback and the webhook end up here, and Razorpay will send
 * the same event more than once, out of order, and sometimes days later. So this
 * is written to be safe to run any number of times: every write is either an
 * upsert or guarded by a uniqueness constraint the database enforces, and the
 * function reports what it actually changed rather than assuming.
 *
 * Payment state and learning entitlement stay separate records on purpose. A
 * refund later marks the payment refunded and expires the enrolment; it does not
 * delete the enrolment, because the learner's progress and attendance are
 * history and history does not get rewritten by a billing event.
 */

export interface FulfilResult {
  ok: boolean;
  alreadyDone: boolean;
  orderId: string;
  enrollmentIds: string[];
  invoiceNo?: string;
  error?: string;
}

export async function fulfilPaidOrder(input: {
  organizationId: string;
  orderId: string;
  gatewayPaymentId: string;
  amountPaise: number;
  method?: string | null;
  raw?: unknown;
}): Promise<FulfilResult> {
  const order = await db.order.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
    include: {
      items: { select: { id: true, productId: true, pricingPlanId: true } },
      invoice: { select: { invoiceNo: true } },
    },
  });

  if (!order) {
    return { ok: false, alreadyDone: false, orderId: input.orderId, enrollmentIds: [], error: 'ORDER_NOT_FOUND' };
  }

  // The gateway is the authority on the amount. If it disagrees with the order we
  // priced, something is wrong and no access is granted on a guess.
  if (input.amountPaise !== order.totalPaise) {
    return {
      ok: false,
      alreadyDone: false,
      orderId: order.id,
      enrollmentIds: [],
      error: `AMOUNT_MISMATCH: gateway ${input.amountPaise}, order ${order.totalPaise}`,
    };
  }

  const existingPayment = await db.payment.findFirst({
    where: {
      organizationId: input.organizationId,
      gateway: 'RAZORPAY',
      gatewayRef: input.gatewayPaymentId,
    },
    select: { id: true, status: true },
  });

  const alreadyCaptured = existingPayment?.status === 'CAPTURED' && order.status === 'PAID';

  const enrollmentIds: string[] = [];
  let invoiceNo = order.invoice?.invoiceNo;

  await db.$transaction(async (tx) => {
    // 1. The payment. Unique on (organisation, gateway, reference), so a repeated
    //    delivery of the same event updates one row instead of creating a second.
    await tx.payment.upsert({
      where: {
        organizationId_gateway_gatewayRef: {
          organizationId: input.organizationId,
          gateway: 'RAZORPAY',
          gatewayRef: input.gatewayPaymentId,
        },
      },
      create: {
        organizationId: input.organizationId,
        orderId: order.id,
        userId: order.userId,
        gateway: 'RAZORPAY',
        gatewayRef: input.gatewayPaymentId,
        method: input.method ?? null,
        amountPaise: input.amountPaise,
        currency: order.currency,
        status: 'CAPTURED',
        capturedAt: new Date(),
        raw: (input.raw ?? undefined) as Prisma.InputJsonValue,
      },
      update: {
        status: 'CAPTURED',
        capturedAt: new Date(),
        method: input.method ?? undefined,
        raw: (input.raw ?? undefined) as Prisma.InputJsonValue,
      },
    });

    // 2. The order.
    if (order.status !== 'PAID') {
      await tx.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
    }

    // 3. Entitlement, one per item. The unique key on
    //    (user, product, batch) is what makes a second delivery harmless.
    const branchId = order.branchId;

    for (const item of order.items) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        select: { course: { select: { id: true } } },
      });

      const batch = product?.course
        ? await tx.batch.findFirst({
            where: {
              courseId: product.course.id,
              status: { in: ['ACTIVE', 'UPCOMING'] },
              deletedAt: null,
            },
            orderBy: [{ isDefault: 'desc' }, { startDate: 'asc' }],
            select: { id: true },
          })
        : null;

      const plan = item.pricingPlanId
        ? await tx.pricingPlan.findUnique({
            where: { id: item.pricingPlanId },
            select: { validityDays: true },
          })
        : null;

      const existing = await tx.enrollment.findFirst({
        where: {
          userId: order.userId,
          productId: item.productId,
          batchId: batch?.id ?? null,
        },
        select: { id: true, status: true },
      });

      if (existing) {
        // A previously cancelled or expired enrolment is revived by a new
        // payment rather than duplicated.
        if (existing.status === 'CANCELLED' || existing.status === 'EXPIRED') {
          await tx.enrollment.update({
            where: { id: existing.id },
            data: {
              status: 'ENROLLED',
              orderItemId: item.id,
              startsAt: new Date(),
              expiresAt: plan?.validityDays
                ? new Date(Date.now() + plan.validityDays * 864e5)
                : null,
            },
          });
        }
        enrollmentIds.push(existing.id);
        continue;
      }

      const created = await tx.enrollment.create({
        data: {
          organizationId: input.organizationId,
          branchId,
          userId: order.userId,
          productId: item.productId,
          batchId: batch?.id ?? null,
          pricingPlanId: item.pricingPlanId,
          orderItemId: item.id,
          status: 'ENROLLED',
          source: 'SELF',
          startsAt: new Date(),
          expiresAt: plan?.validityDays
            ? new Date(Date.now() + plan.validityDays * 864e5)
            : null,
        },
        select: { id: true },
      });
      enrollmentIds.push(created.id);
    }

    // 4. The invoice. Numbered inside the transaction, and the global unique on
    //    invoiceNo is the backstop if two orders are paid in the same instant.
    if (!invoiceNo) {
      const tax = await tx.taxConfig.findFirst({
        where: { organizationId: input.organizationId },
        select: { cgstPercent: true, sgstPercent: true, igstPercent: true, state: true },
      });

      const count = await tx.invoice.count({
        where: { order: { organizationId: input.organizationId } },
      });

      const year = new Date().getFullYear();
      invoiceNo = `INV-${year}-${String(count + 1).padStart(5, '0')}`;

      const interState = false; // no billing state is collected yet, so intra-state
      const taxableValue = order.subtotalPaise - order.discountPaise;

      await tx.invoice.create({
        data: {
          orderId: order.id,
          invoiceNo,
          taxBreakup: {
            taxableValue,
            cgst: interState ? 0 : Math.round((taxableValue * (tax?.cgstPercent ?? 9)) / 100),
            sgst: interState ? 0 : Math.round((taxableValue * (tax?.sgstPercent ?? 9)) / 100),
            igst: interState ? order.taxPaise : 0,
            total: order.totalPaise,
          },
          placeOfSupply: tax?.state ?? null,
        },
      });
    }
  });

  await recordAudit({
    organizationId: input.organizationId,
    actorId: order.userId,
    action: alreadyCaptured ? 'payment.replayed' : 'payment.captured',
    entity: 'Order',
    entityId: order.id,
    after: { gatewayPaymentId: input.gatewayPaymentId, amountPaise: input.amountPaise },
  });

  return {
    ok: true,
    alreadyDone: alreadyCaptured,
    orderId: order.id,
    enrollmentIds,
    invoiceNo,
  };
}

/** A failed attempt is recorded too, so a support question has an answer. */
export async function recordFailedPayment(input: {
  organizationId: string;
  orderId?: string | null;
  userId?: string | null;
  gatewayPaymentId: string;
  amountPaise: number;
  reason?: string | null;
  raw?: unknown;
}) {
  await db.payment.upsert({
    where: {
      organizationId_gateway_gatewayRef: {
        organizationId: input.organizationId,
        gateway: 'RAZORPAY',
        gatewayRef: input.gatewayPaymentId,
      },
    },
    create: {
      organizationId: input.organizationId,
      orderId: input.orderId ?? null,
      userId: input.userId ?? null,
      gateway: 'RAZORPAY',
      gatewayRef: input.gatewayPaymentId,
      amountPaise: input.amountPaise,
      status: 'FAILED',
      failureReason: input.reason ?? null,
      raw: (input.raw ?? undefined) as Prisma.InputJsonValue,
    },
    update: {
      status: 'FAILED',
      failureReason: input.reason ?? undefined,
      raw: (input.raw ?? undefined) as Prisma.InputJsonValue,
    },
  });

  if (input.orderId) {
    await db.order.updateMany({
      where: { id: input.orderId, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  }
}
