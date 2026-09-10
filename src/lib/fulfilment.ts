import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import type { Prisma } from '@prisma/client';
import { markCartConverted } from '@/lib/cart';
import { credit, creditOnPurchase } from '@/lib/wallet';
import { reportConversion } from '@/lib/analytics-server';
import { emit } from '@/lib/webhooks';
import { memberRef } from '@/lib/loyalty-provider';
import { queueNotifications } from '@/lib/notify';

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
  /** Shown to the learner and searchable in the admin, so support has a handle. */
  reference?: string;
}

/**
 * A refusal is written down, not just logged.
 *
 * Money has moved and access has not been granted, which is the worst state this
 * system can be in. A console line does not survive the next deploy, so the
 * reason goes into gateway_events where it outlives the process and shows up in
 * the admin.
 */
async function recordRefusal(input: {
  organizationId: string;
  orderId: string;
  gatewayPaymentId: string;
  reason: string;
  detail: Record<string, unknown>;
}) {
  console.error('[fulfilment] refused', input.reason, input.detail);
  try {
    await db.gatewayEvent.create({
      data: {
        organizationId: input.organizationId,
        gateway: 'RAZORPAY',
        eventId: `refusal:${input.gatewayPaymentId}:${Date.now()}`,
        event: 'fulfilment.refused',
        payload: { orderId: input.orderId, ...input.detail } as Prisma.InputJsonValue,
        signatureOk: true,
        error: input.reason,
      },
    });
  } catch (err) {
    console.error('[fulfilment] could not record the refusal', err);
  }
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
    await recordRefusal({
      organizationId: input.organizationId,
      orderId: input.orderId,
      gatewayPaymentId: input.gatewayPaymentId,
      reason: 'ORDER_NOT_FOUND',
      detail: { gatewayPaymentId: input.gatewayPaymentId, amountPaise: input.amountPaise },
    });
    return {
      ok: false,
      alreadyDone: false,
      orderId: input.orderId,
      enrollmentIds: [],
      error: 'ORDER_NOT_FOUND',
    };
  }

  // The gateway is the authority on the amount. If it disagrees with the order we
  // priced, something is wrong and no access is granted on a guess.
  if (input.amountPaise !== order.totalPaise) {
    await recordRefusal({
      organizationId: input.organizationId,
      orderId: order.id,
      gatewayPaymentId: input.gatewayPaymentId,
      reason: 'AMOUNT_MISMATCH',
      detail: {
        orderNo: order.orderNo,
        gatewayAmountPaise: input.amountPaise,
        orderTotalPaise: order.totalPaise,
        gatewayPaymentId: input.gatewayPaymentId,
      },
    });

    // The payment is still recorded, so the money is never invisible. It simply
    // is not attached to an order, and it surfaces in the admin as unmatched.
    await recordFailedPayment({
      organizationId: input.organizationId,
      orderId: order.id,
      userId: order.userId,
      gatewayPaymentId: input.gatewayPaymentId,
      amountPaise: input.amountPaise,
      reason: `Amount did not match order ${order.orderNo}: gateway ${input.amountPaise}, order ${order.totalPaise}`,
      raw: input.raw,
    });

    return {
      ok: false,
      alreadyDone: false,
      orderId: order.id,
      enrollmentIds: [],
      reference: order.orderNo,
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

  const runFulfilment = async () => {
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

  };

  // An exception in here means money moved and access did not follow, so it is
  // written down rather than becoming an anonymous 500 nobody can trace.
  try {
    await runFulfilment();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRefusal({
      organizationId: input.organizationId,
      orderId: order.id,
      gatewayPaymentId: input.gatewayPaymentId,
      reason: 'FULFILMENT_THREW',
      detail: { orderNo: order.orderNo, message },
    });
    return {
      ok: false,
      alreadyDone: false,
      orderId: order.id,
      enrollmentIds: [],
      reference: order.orderNo,
      error: `FULFILMENT_THREW: ${message}`,
    };
  }

  // They bought, so they are no longer somebody to chase.
  await markCartConverted(input.organizationId, order.userId);

  // And whoever brought them here gets their cut, once.
  await creditOnPurchase({
    organizationId: input.organizationId,
    userId: order.userId,
    orderId: order.id,
  });

  await recordAudit({
    organizationId: input.organizationId,
    actorId: order.userId,
    action: alreadyCaptured ? 'payment.replayed' : 'payment.captured',
    entity: 'Order',
    entityId: order.id,
    after: { gatewayPaymentId: input.gatewayPaymentId, amountPaise: input.amountPaise },
  });

  // Everything from here is told-the-world work: a receipt, the ad platforms,
  // and anyone subscribed to a webhook. None of it may fail the fulfilment,
  // because the money has moved and the access has been granted, and an
  // enrolment must not be undone because Meta timed out. And none of it runs on
  // a replay, or a learner gets a second receipt every time Razorpay retries.
  if (!alreadyCaptured) {
    await tellTheWorld({
      organizationId: input.organizationId,
      orderId: order.id,
      orderNo: order.orderNo,
      userId: order.userId,
      amountPaise: order.totalPaise,
      invoiceNo,
      enrollmentIds,
    }).catch((err: unknown) => {
      console.error(
        '[fulfilment] the enrolment stands, but reporting it failed:',
        err instanceof Error ? err.message : err,
      );
    });
  }

  return {
    ok: true,
    alreadyDone: alreadyCaptured,
    orderId: order.id,
    enrollmentIds,
    invoiceNo,
    reference: order.orderNo,
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
    const marked = await db.order.updateMany({
      where: { id: input.orderId, status: 'PENDING' },
      data: { status: 'FAILED' },
    });

    // The promo code was reserved when the order was written, and any loyalty
    // points were taken. A payment that never landed should hold neither, so
    // both go back when the order does.
    if (marked.count > 0) {
      await db.promoRedemption.deleteMany({ where: { orderId: input.orderId } });

      const spent = await db.walletTransaction.findFirst({
        where: { orderId: input.orderId, reason: 'REDEMPTION' },
        select: { id: true, points: true, wallet: { select: { userId: true } } },
      });

      if (spent && spent.points < 0) {
        await credit({
          userId: spent.wallet.userId,
          points: -spent.points,
          reason: 'ADMIN',
          note: 'Returned: the payment did not complete',
          orderId: input.orderId,
        });
      }
    }
  }
}

/**
 * Telling everyone else that a payment happened.
 *
 * Deliberately outside the fulfilment transaction and deliberately unable to
 * fail it. A conversion that does not reach Meta is a reporting problem; an
 * enrolment rolled back because Meta was slow is a customer problem, and the
 * two are not close in seriousness.
 *
 * Three audiences. The learner, who gets a receipt. The ad platforms, keyed on
 * the order number so the server event deduplicates against the browser pixel
 * rather than counting the same admission twice. And whatever the academy has
 * pointed a webhook at.
 */
async function tellTheWorld(input: {
  organizationId: string;
  orderId: string;
  orderNo: string;
  userId: string;
  amountPaise: number;
  invoiceNo?: string | null;
  enrollmentIds: string[];
}): Promise<void> {
  const [buyer, organization, items] = await Promise.all([
    db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, name: true, email: true, phone: true },
    }),
    db.organization.findUnique({
      where: { id: input.organizationId },
      select: { name: true, currency: true },
    }),
    db.orderItem.findMany({
      where: { orderId: input.orderId },
      select: { titleSnapshot: true },
    }),
  ]);

  const what = items.map((row) => row.titleSnapshot).filter(Boolean).join(', ') || 'your course';
  const amount = `INR ${(input.amountPaise / 100).toFixed(2)}`;

  if (buyer) {
    await queueNotifications({
      organizationId: input.organizationId,
      eventKey: 'payment.received',
      recipients: [{ userId: buyer.id, email: buyer.email, phone: buyer.phone }],
      // The order number, so a retried webhook cannot queue a second receipt
      // even if it somehow reaches here twice.
      dedupeKey: `payment.received:${input.orderId}`,
      context: {
        name: buyer.name,
        amount,
        item: what,
        organization: organization?.name ?? '',
        receiptUrl: input.invoiceNo ? `/learn/invoices/${input.invoiceNo}` : '/learn',
      },
    });
  }

  await reportConversion({
    organizationId: input.organizationId,
    event: 'purchase',
    // The order number is what the browser pixel also sends, and matching ids
    // is the whole mechanism by which one admission counts once.
    eventId: input.orderNo,
    valuePaise: input.amountPaise,
    currency: organization?.currency ?? 'INR',
    email: buyer?.email ?? null,
    phone: buyer?.phone ?? null,
  });

  // The member travels with the event. A loyalty platform on the other end
  // matches on email and needs a name to greet somebody by; sending only a
  // user id would make it useless without a second call back into here.
  const member = buyer ? memberRef(buyer) : null;

  await emit(input.organizationId, 'payment.captured', {
    orderId: input.orderId,
    orderNo: input.orderNo,
    amountPaise: input.amountPaise,
    invoiceNo: input.invoiceNo ?? null,
    userId: input.userId,
    member,
    items: items.map((row) => row.titleSnapshot),
  });

  if (input.enrollmentIds.length) {
    await emit(input.organizationId, 'enrolment.created', {
      orderNo: input.orderNo,
      userId: input.userId,
      enrollmentIds: input.enrollmentIds,
      member,
      items: items.map((row) => row.titleSnapshot),
    });
  }
}
