'use server';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { computeTax } from '@/lib/money';
import { createRazorpayOrder, paymentsConfigured } from '@/lib/razorpay';

/**
 * Checkout starts here, and every number on it is computed here.
 *
 * The browser sends a product id and a plan id. It never sends an amount, a
 * discount or a tax figure, so there is nothing on the client worth tampering
 * with. The order is written before the gateway is called, so a payment always
 * has something on our side to reconcile against.
 */

export type CheckoutStart =
  | { ok: true; orderId: string }
  | { ok: false; error: string; signIn?: true };

export async function startCheckout(
  productId: string,
  pricingPlanId?: string,
): Promise<CheckoutStart> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Please sign in to continue.', signIn: true };

    if (!paymentsConfigured()) {
      return { ok: false, error: 'Online payment is not switched on yet. Please contact the academy.' };
    }

    const product = await db.product.findFirst({
      where: {
        id: productId,
        organizationId: tenant.organizationId,
        status: 'PUBLISHED',
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        course: { select: { id: true, onDemandOnly: true } },
        pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!product) return { ok: false, error: 'That course is not available.' };
    if (product.course?.onDemandOnly) {
      return { ok: false, error: 'This course is enrolled by the academy. Please contact them.' };
    }

    const existing = await db.enrollment.findFirst({
      where: { userId: user.id, productId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
      select: { id: true },
    });
    if (existing) return { ok: false, error: 'You are already enrolled in this course.' };

    const plan = product.pricingPlans.find((p) => p.id === pricingPlanId) ?? product.pricingPlans[0];
    if (!plan) return { ok: false, error: 'This course has no price set. Please contact the academy.' };
    if (plan.pricePaise <= 0) {
      return { ok: false, error: 'This course is free. Use Enrol rather than checkout.' };
    }

    const branch = await db.branch.findFirst({
      where: { organizationId: tenant.organizationId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) return { ok: false, error: 'This academy has no branch configured.' };

    const taxConfig = await db.taxConfig.findFirst({
      where: { organizationId: tenant.organizationId },
    });

    const tax = computeTax({
      amountPaise: plan.pricePaise,
      cgstPercent: taxConfig?.cgstPercent ?? 9,
      sgstPercent: taxConfig?.sgstPercent ?? 9,
      igstPercent: taxConfig?.igstPercent ?? 18,
      // No billing state is collected yet, so supply is treated as intra-state.
      // When the checkout asks for one, this is the only line that changes.
      interState: false,
      pricesAreExclusive: taxConfig?.pricesAreExclusive ?? true,
    });

    const taxPaise = tax.totalPaise - tax.taxablePaise;
    const enabled = taxConfig?.enabled ?? true;
    const totalPaise = enabled ? tax.totalPaise : plan.pricePaise;

    const count = await db.order.count({ where: { organizationId: tenant.organizationId } });
    const orderNo = `ORD-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    const order = await db.order.create({
      data: {
        organizationId: tenant.organizationId,
        branchId: branch.id,
        userId: user.id,
        orderNo,
        status: 'PENDING',
        currency: plan.currency,
        subtotalPaise: plan.pricePaise,
        discountPaise: 0,
        taxPaise: enabled ? taxPaise : 0,
        totalPaise,
        items: {
          create: {
            productId: product.id,
            pricingPlanId: plan.id,
            titleSnapshot: product.title,
            pricePaise: plan.pricePaise,
            taxPaise: enabled ? taxPaise : 0,
            totalPaise,
          },
        },
      },
      select: { id: true, orderNo: true, currency: true, totalPaise: true },
    });

    const gatewayOrder = await createRazorpayOrder({
      amountPaise: order.totalPaise,
      currency: order.currency,
      receipt: order.orderNo,
      notes: { orderId: order.id, organizationId: tenant.organizationId },
    });

    await db.order.update({
      where: { id: order.id },
      data: { gatewayOrderId: gatewayOrder.id },
    });

    return { ok: true, orderId: order.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[checkout]', message);
    if (message.startsWith('RAZORPAY:')) {
      return { ok: false, error: 'The payment gateway refused to start this order. Please try again.' };
    }
    return { ok: false, error: 'We could not start checkout just now. Please try again.' };
  }
}
