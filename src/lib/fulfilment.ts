import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import type { Prisma } from '@prisma/client';
import { markCartConverted } from '@/lib/cart';
import { credit, creditOnPurchase } from '@/lib/wallet';
import { reportConversion } from '@/lib/analytics-server';
import { emit } from '@/lib/webhooks';
import { memberRef } from '@/lib/loyalty-provider';
import { queueNotifications } from '@/lib/notify';
import { invoicePrefix, nextInvoiceNumber } from '@/lib/invoice-number';
import { checkPaidAmount } from '@/lib/payment-amount';

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

/** Prisma's code for a unique index refusing a second row. */
function isDuplicate(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}

export async function fulfilPaidOrder(input: {
  organizationId: string;
  orderId: string;
  gatewayPaymentId: string;
  amountPaise: number;
  /**
   * The gateway's own fee on this payment, in paise, as the gateway reports
   * it. It matters when the academy's account charges that fee to the
   * customer: the captured amount is then the order plus the fee, and
   * without this the payment reads as the wrong amount.
   */
  feePaise?: number | null;
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

  /*
   * The gateway is the authority on the amount, and the amount has to
   * reconcile with the order before anything is granted.
   *
   * "Reconcile" is not "be equal". An academy whose Razorpay account charges
   * the gateway fee to the customer captures the order plus that fee, which
   * is a correct payment arriving as a larger number. That case is
   * recognised and recorded; everything else is still refused.
   */
  const amount = checkPaidAmount({
    grossPaise: input.amountPaise,
    orderPaise: order.totalPaise,
    feePaise: input.feePaise ?? null,
  });

  if (!amount.ok) {
    await recordRefusal({
      organizationId: input.organizationId,
      orderId: order.id,
      gatewayPaymentId: input.gatewayPaymentId,
      reason: 'AMOUNT_MISMATCH',
      detail: {
        orderNo: order.orderNo,
        gatewayAmountPaise: input.amountPaise,
        orderTotalPaise: order.totalPaise,
        gatewayFeePaise: input.feePaise ?? null,
        why: amount.reason,
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
      reason: `Amount did not reconcile with order ${order.orderNo} (${amount.reason}): gateway ${input.amountPaise}, order ${order.totalPaise}, fee ${input.feePaise ?? 'unknown'}`,
      raw: input.raw,
    });

    return {
      ok: false,
      alreadyDone: false,
      orderId: order.id,
      enrollmentIds: [],
      reference: order.orderNo,
      error: `AMOUNT_MISMATCH (${amount.reason}): gateway ${input.amountPaise}, order ${order.totalPaise}`,
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

  /*
   * Everything that only reads is done before the transaction opens.
   *
   * This used to sit inside it: for each item a product, a batch and a plan,
   * then the tax config and an invoice count, each one a round trip to a
   * database in another region. A dozen of those inside one interactive
   * transaction is several seconds of wall clock, and Prisma closes an
   * interactive transaction after five, at which point money has moved and
   * nobody is enrolled. Reading first leaves the transaction holding writes
   * only, which is what it is for.
   */
  const context = await Promise.all(
    order.items.map(async (item) => {
      const product = await db.product.findFirst({
        where: { id: item.productId, organizationId: input.organizationId },
        select: { course: { select: { id: true } } },
      });

      const [batch, plan] = await Promise.all([
        product?.course
          ? db.batch.findFirst({
              where: {
                organizationId: input.organizationId,
                courseId: product.course.id,
                status: { in: ['ACTIVE', 'UPCOMING'] },
                deletedAt: null,
              },
              orderBy: [{ isDefault: 'desc' }, { startDate: 'asc' }],
              select: { id: true },
            })
          : Promise.resolve(null),
        item.pricingPlanId
          ? db.pricingPlan.findUnique({
              where: { id: item.pricingPlanId },
              select: { validityDays: true },
            })
          : Promise.resolve(null),
      ]);

      return { item, batchId: batch?.id ?? null, validityDays: plan?.validityDays ?? null };
    }),
  );

  const taxConfig = invoiceNo
    ? null
    : await db.taxConfig.findFirst({
        where: { organizationId: input.organizationId },
        select: { cgstPercent: true, sgstPercent: true, igstPercent: true, state: true },
      });

  /**
   * The next invoice number for this academy.
   *
   * Counting rows and adding one is fine until a number is ever skipped or a
   * row removed, after which the count keeps producing a number that already
   * exists and every payment after it fails on the unique index. Reading the
   * highest number actually issued cannot drift that way.
   */
  async function nextInvoiceNo(): Promise<string> {
    const prefix = invoicePrefix(new Date().getFullYear());

    const latest = await db.invoice.findFirst({
      where: { invoiceNo: { startsWith: prefix }, order: { organizationId: input.organizationId } },
      orderBy: { invoiceNo: 'desc' },
      select: { invoiceNo: true },
    });

    return nextInvoiceNumber(latest?.invoiceNo ?? null, prefix);
  }

  const runFulfilment = async () => {
  // A second attempt starts from nothing, or it reports the enrolments of the
  // attempt that failed as well as its own.
  enrollmentIds.length = 0;

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

    for (const { item, batchId: itemBatchId, validityDays } of context) {
      const existing = await tx.enrollment.findFirst({
        where: {
          userId: order.userId,
          productId: item.productId,
          batchId: itemBatchId,
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
              expiresAt: validityDays ? new Date(Date.now() + validityDays * 864e5) : null,
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
          batchId: itemBatchId,
          pricingPlanId: item.pricingPlanId,
          orderItemId: item.id,
          status: 'ENROLLED',
          source: 'SELF',
          startsAt: new Date(),
          expiresAt: validityDays ? new Date(Date.now() + validityDays * 864e5) : null,
        },
        select: { id: true },
      });
      enrollmentIds.push(created.id);
    }

    // 4. The invoice. Numbered inside the transaction, and the global unique on
    //    invoiceNo is the backstop if two orders are paid in the same instant.
    if (!invoiceNo) {
      const tax = taxConfig;
      invoiceNo = await nextInvoiceNo();

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
  },
  {
    /*
     * Wider than Prisma's five second default, because this transaction is
     * held open across a network to a database in another region, and the
     * cost of it expiring is the worst state this system has: money taken,
     * access not granted. Twenty seconds is still short enough that a genuine
     * deadlock surfaces rather than hangs.
     */
    timeout: 20_000,
    maxWait: 10_000,
  });

  };

  // An exception in here means money moved and access did not follow, so it is
  // written down rather than becoming an anonymous 500 nobody can trace.
  //
  // One failure is worth retrying rather than recording: two payments landing
  // in the same second both read the same highest invoice number and one of
  // them loses the unique index. Reading it again gives the next free one, so
  // the loser tries once more instead of becoming a support ticket.
  let attempt = 0;
  let failure: unknown = null;

  while (attempt < 3) {
    attempt += 1;
    try {
      await runFulfilment();
      failure = null;
      break;
    } catch (err) {
      failure = err;
      if (!isDuplicate(err)) break;
      invoiceNo = order.invoice?.invoiceNo;
    }
  }

  if (failure) {
    const err = failure;
    const message = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : undefined;
    await recordRefusal({
      organizationId: input.organizationId,
      orderId: order.id,
      gatewayPaymentId: input.gatewayPaymentId,
      reason: 'FULFILMENT_THREW',
      detail: { orderNo: order.orderNo, message, code, attempts: attempt },
    });
    return {
      ok: false,
      alreadyDone: false,
      orderId: order.id,
      enrollmentIds: [],
      reference: order.orderNo,
      error: `FULFILMENT_THREW: ${code ? `${code} ` : ''}${message}`,
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
