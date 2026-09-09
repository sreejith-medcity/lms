'use server';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { computeTax } from '@/lib/money';
import { createRazorpayOrder, paymentsConfigured } from '@/lib/razorpay';
import { claimPromo, PromoRefused } from '@/lib/promo-claim';
import { rememberIntent } from '@/lib/cart';
import { credit, loyaltyConfig, pointsToPaise, redeemablePoints } from '@/lib/wallet';

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
  promoCode?: string,
  usePoints = false,
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

    // The discount comes off before tax, because GST is owed on what was
    // actually charged, not on the list price.
    const claim = promoCode?.trim()
      ? await db
          .$transaction((tx) =>
            claimPromo(tx, {
              organizationId: tenant.organizationId,
              rawCode: promoCode,
              userId: user.id,
              productId: product.id,
              subtotalPaise: plan.pricePaise,
            }),
          )
          .catch((err: unknown) => {
            if (err instanceof PromoRefused) return err;
            throw err;
          })
      : null;

    if (claim instanceof PromoRefused) return { ok: false, error: claim.message };

    const discountPaise = claim?.discountPaise ?? 0;
    const taxablePaise = Math.max(0, plan.pricePaise - discountPaise);

    const tax = computeTax({
      amountPaise: taxablePaise,
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
    const beforePoints = enabled ? tax.totalPaise : taxablePaise;

    // Points come off the payable total rather than the price, because the
    // academy still owes GST on what the course was sold for.
    const loyalty = await loyaltyConfig(tenant.organizationId);
    const wallet = usePoints
      ? await db.walletAccount.findUnique({
          where: { userId: user.id },
          select: { balancePoints: true },
        })
      : null;

    const spendPoints = wallet
      ? redeemablePoints(wallet.balancePoints, beforePoints, loyalty)
      : 0;
    const walletPaise = pointsToPaise(spendPoints, loyalty);
    const totalPaise = Math.max(0, beforePoints - walletPaise);

    if (totalPaise <= 0) {
      return {
        ok: false,
        error: 'Points cannot cover the whole order. Please contact the academy.',
      };
    }

    const count = await db.order.count({ where: { organizationId: tenant.organizationId } });
    const orderNo = `ORD-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    // The order and its reservation of the code are written together: an order
    // that quotes a discount nobody recorded is how a code gets spent twice.
    const order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          organizationId: tenant.organizationId,
          branchId: branch.id,
          userId: user.id,
          orderNo,
          status: 'PENDING',
          currency: plan.currency,
          subtotalPaise: plan.pricePaise,
          discountPaise,
          taxPaise: enabled ? taxPaise : 0,
          walletPaise,
          totalPaise,
          promoCodeId: claim?.promoCodeId ?? null,
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

      if (claim) {
        await tx.promoRedemption.create({
          data: {
            promoCodeId: claim.promoCodeId,
            userId: user.id,
            orderId: created.id,
            amountPaise: claim.discountPaise,
          },
        });
      }

      // Points are taken now, in the same transaction as the order that spends
      // them, and given back by `recordFailedPayment` if it never completes.
      if (spendPoints > 0) {
        await credit({
          tx,
          userId: user.id,
          points: -spendPoints,
          reason: 'REDEMPTION',
          note: `Spent on ${created.orderNo}`,
          orderId: created.id,
        });
      }

      return created;
    });

    // Recorded before the gateway is called, so somebody who bounces off the
    // payment screen still shows up on the recovery list.
    await rememberIntent(product.id, plan.id);

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
