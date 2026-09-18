import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { priceOrder } from '@/lib/order-lines';
import { paymentsAvailable, prepareOrder } from '@/lib/payments';
import { balanceOf } from '@/lib/dues';

/**
 * Turning an open instalment or charge into an order the gateway can
 * take. One path for whoever presses Pay: the learner from their fees
 * page, or a linked parent from the parent view. The order belongs to the
 * learner either way, because the instalment does; who pressed the button
 * is recorded on the order's attribution and the audit trail, not on the
 * ledger.
 *
 * Idempotent on the pending order: a payment window closed and reopened
 * lands on the same order, never a second one for the same instalment.
 */

export type CheckoutStart = { ok: true; orderId: string } | { ok: false; error: string };

export interface CheckoutContext {
  organizationId: string;
  currency: string;
  /** The learner the instalment belongs to. */
  userId: string;
  attribution: Prisma.InputJsonValue | undefined;
}

async function nextOrderNo(organizationId: string): Promise<string> {
  const count = await db.order.count({ where: { organizationId } });
  return `ORD-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;
}

export async function beginInstalmentOrder(ctx: CheckoutContext, instalmentId: string): Promise<CheckoutStart> {
  if (!(await paymentsAvailable(ctx.organizationId))) {
    return { ok: false, error: 'Online payment is not switched on yet. Please pay at the academy.' };
  }

  const instalment = await db.instalment.findFirst({
    where: { id: instalmentId, paidAt: null, enrollment: { organizationId: ctx.organizationId, userId: ctx.userId } },
    select: {
      id: true,
      sequence: true,
      amountPaise: true,
      paidPaise: true,
      enrollment: {
        select: {
          id: true,
          branchId: true,
          productId: true,
          pricingPlanId: true,
          product: { select: { title: true } },
          instalments: { where: { paidAt: null }, orderBy: { dueDate: 'asc' }, select: { id: true, amountPaise: true, paidPaise: true }, take: 1 },
          _count: { select: { instalments: true } },
        },
      },
    },
  });
  if (!instalment) return { ok: false, error: 'That instalment is not open.' };

  // Always the oldest open one: paying a later part while an earlier one is
  // open would leave the ageing wrong and the office confused.
  const oldest = instalment.enrollment.instalments.find((i) => balanceOf(i) > 0);
  if (oldest && oldest.id !== instalment.id) return { ok: false, error: 'Please pay the earlier instalment first.' };

  const balance = balanceOf(instalment);
  if (balance <= 0) return { ok: false, error: 'That instalment is already paid.' };

  const pending = await db.order.findFirst({
    where: { organizationId: ctx.organizationId, userId: ctx.userId, status: 'PENDING', gatewayOrderId: { not: null }, items: { some: { instalmentId: instalment.id } } },
    select: { id: true, totalPaise: true },
  });
  if (pending && pending.totalPaise > 0) return { ok: true, orderId: pending.id };

  const taxConfig = await db.taxConfig.findFirst({ where: { organizationId: ctx.organizationId } });
  const priced = priceOrder({
    lines: [
      {
        productId: instalment.enrollment.productId,
        pricingPlanId: instalment.enrollment.pricingPlanId,
        title: `${instalment.enrollment.product.title} (instalment ${instalment.sequence} of ${instalment.enrollment._count.instalments})`,
        pricePaise: balance,
        isPrimary: true,
      },
    ],
    discountPaise: 0,
    tax: {
      cgstPercent: taxConfig?.cgstPercent ?? 9,
      sgstPercent: taxConfig?.sgstPercent ?? 9,
      igstPercent: taxConfig?.igstPercent ?? 18,
      interState: false,
      pricesAreExclusive: taxConfig?.pricesAreExclusive ?? true,
      enabled: taxConfig?.enabled ?? true,
    },
  });

  const order = await db.order.create({
    data: {
      organizationId: ctx.organizationId,
      branchId: instalment.enrollment.branchId,
      userId: ctx.userId,
      orderNo: await nextOrderNo(ctx.organizationId),
      status: 'PENDING',
      attribution: ctx.attribution,
      currency: ctx.currency,
      subtotalPaise: priced.subtotalPaise,
      discountPaise: 0,
      taxPaise: priced.taxPaise,
      walletPaise: 0,
      totalPaise: priced.beforePointsPaise,
      items: {
        create: priced.lines.map((l) => ({
          productId: l.productId,
          pricingPlanId: l.pricingPlanId,
          instalmentId: instalment.id,
          titleSnapshot: l.title,
          pricePaise: l.pricePaise,
          discountPaise: l.discountPaise,
          taxPaise: l.taxPaise,
          totalPaise: l.totalPaise,
        })),
      },
    },
    select: { id: true, orderNo: true, currency: true, totalPaise: true },
  });

  await prepareOrder(ctx.organizationId, order, { instalmentId: instalment.id });
  return { ok: true, orderId: order.id };
}

export async function beginMiscFeeOrder(ctx: CheckoutContext, feeId: string): Promise<CheckoutStart> {
  if (!(await paymentsAvailable(ctx.organizationId))) {
    return { ok: false, error: 'Online payment is not switched on yet. Please pay at the academy.' };
  }

  const fee = await db.miscFee.findFirst({
    where: { id: feeId, organizationId: ctx.organizationId, userId: ctx.userId, status: 'PENDING' },
    select: { id: true, label: true, amountPaise: true, taxable: true, enrollment: { select: { branchId: true, productId: true, pricingPlanId: true, product: { select: { title: true } } } } },
  });
  if (!fee) return { ok: false, error: 'That charge is not open.' };

  const pending = await db.order.findFirst({
    where: { organizationId: ctx.organizationId, userId: ctx.userId, status: 'PENDING', gatewayOrderId: { not: null }, items: { some: { miscFeeId: fee.id } } },
    select: { id: true, totalPaise: true },
  });
  if (pending && pending.totalPaise > 0) return { ok: true, orderId: pending.id };

  const taxConfig = await db.taxConfig.findFirst({ where: { organizationId: ctx.organizationId } });
  const priced = priceOrder({
    lines: [{ productId: fee.enrollment.productId, pricingPlanId: fee.enrollment.pricingPlanId, title: `${fee.label} (${fee.enrollment.product.title})`, pricePaise: fee.amountPaise, isPrimary: true }],
    discountPaise: 0,
    tax: {
      cgstPercent: taxConfig?.cgstPercent ?? 9,
      sgstPercent: taxConfig?.sgstPercent ?? 9,
      igstPercent: taxConfig?.igstPercent ?? 18,
      interState: false,
      pricesAreExclusive: taxConfig?.pricesAreExclusive ?? true,
      enabled: fee.taxable && (taxConfig?.enabled ?? true),
    },
  });

  const order = await db.order.create({
    data: {
      organizationId: ctx.organizationId,
      branchId: fee.enrollment.branchId,
      userId: ctx.userId,
      orderNo: await nextOrderNo(ctx.organizationId),
      status: 'PENDING',
      attribution: ctx.attribution,
      currency: ctx.currency,
      subtotalPaise: priced.subtotalPaise,
      discountPaise: 0,
      taxPaise: priced.taxPaise,
      walletPaise: 0,
      totalPaise: priced.beforePointsPaise,
      items: {
        create: priced.lines.map((l) => ({
          productId: l.productId,
          pricingPlanId: l.pricingPlanId,
          miscFeeId: fee.id,
          titleSnapshot: l.title,
          pricePaise: l.pricePaise,
          discountPaise: l.discountPaise,
          taxPaise: l.taxPaise,
          totalPaise: l.totalPaise,
        })),
      },
    },
    select: { id: true, orderNo: true, currency: true, totalPaise: true },
  });

  await prepareOrder(ctx.organizationId, order, { miscFeeId: fee.id });
  return { ok: true, orderId: order.id };
}

/** What went wrong, in words for the person who pressed the button. */
export function checkoutFailure(err: unknown, tag: string): CheckoutStart {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${tag}] checkout`, message);
  if (message.startsWith('RAZORPAY:')) return { ok: false, error: 'The payment gateway refused to start this payment. Please try again.' };
  return { ok: false, error: 'We could not start the payment just now. Please try again.' };
}
