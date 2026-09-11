'use server';

import { cookies } from 'next/headers';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { priceOrder } from '@/lib/order-lines';
import { resolveSelectedAddons } from '@/lib/addons';
import { createRazorpayOrder, paymentsConfigured } from '@/lib/razorpay';
import { claimPromo, PromoRefused } from '@/lib/promo-claim';
import { rememberIntent, readBasket, CART_COOKIE } from '@/lib/cart';
import { promoTarget } from '@/lib/cart-rules';
import { normaliseContact, type GuestContact } from '@/lib/guest-checkout';
import { headers } from 'next/headers';
import { authAttemptKeys, checkAll, tooManyAttemptsMessage } from '@/lib/rate-limit';
import { credit, loyaltyConfig, pointsToPaise, redeemablePoints } from '@/lib/wallet';
import { scheduleFromPlan } from '@/lib/dues';

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
  /**
   * Extras the buyer ticked. Product ids only: the price of each one is read
   * from its own plan here, and anything not attached to this course as an
   * add-on is dropped rather than bought.
   */
  addonProductIds: string[] = [],
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
        isAddonOnly: true,
        course: { select: { id: true, onDemandOnly: true } },
        pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!product) return { ok: false, error: 'That course is not available.' };
    if (product.course?.onDemandOnly) {
      return { ok: false, error: 'This course is enrolled by the academy. Please contact them.' };
    }
    // An add-on is something you tick alongside a course. Sold on its own it
    // would be a product with no page, bought by somebody who guessed an id.
    if (product.isAddonOnly) {
      return { ok: false, error: 'This is offered alongside a course rather than on its own.' };
    }

    const plan = product.pricingPlans.find((p) => p.id === pricingPlanId) ?? product.pricingPlans[0];
    if (!plan) return { ok: false, error: 'This course has no price set. Please contact the academy.' };

    // Extras are resolved before anything is priced, because whether the buyer
    // already owns the course only decides the outcome once we know whether
    // they are here for something else as well. Nothing the browser sent is
    // trusted for money: it sends product ids, and gets back whatever those
    // products actually cost, if it is allowed them at all.
    const addons = await resolveSelectedAddons({
      organizationId: tenant.organizationId,
      userId: user.id,
      productId: product.id,
      requested: addonProductIds,
    });

    const existing = await db.enrollment.findFirst({
      where: {
        organizationId: tenant.organizationId,
        userId: user.id,
        productId,
        status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      },
      select: { id: true },
    });

    // Somebody who bought the course in June and wants the question bank in
    // September is a normal customer, not an error. They buy the extra on its
    // own, and the course they already have is not charged for again.
    const buyingCourse = !existing;
    if (existing && addons.length === 0) {
      return { ok: false, error: 'You are already enrolled in this course.' };
    }
    if (buyingCourse && plan.pricePaise <= 0 && addons.length === 0) {
      return { ok: false, error: 'This course is free. Use Enrol rather than checkout.' };
    }

    const branch = await db.branch.findFirst({
      where: { organizationId: tenant.organizationId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) return { ok: false, error: 'This academy has no branch configured.' };

    // A plan paid in parts charges its first part now. The rest becomes a
    // dated schedule on the enrolment once this payment lands, and each
    // later part is paid from the learner's fees page or at the counter.
    const parts =
      buyingCourse && plan.planType === 'INSTALMENT' && plan.instalmentCount > 1
        ? scheduleFromPlan(plan, new Date())
        : null;
    const courseChargePaise = parts ? parts[0].amountPaise : plan.pricePaise;
    const courseTitle = parts
      ? `${product.title} (instalment 1 of ${parts.length})`
      : product.title;

    // A code is quoted against the whole fee, and a schedule has no single
    // moment to take it off, so the two are kept apart rather than guessed at.
    if (parts && promoCode?.trim()) {
      return { ok: false, error: 'Promo codes apply to full-payment plans, not instalment plans.' };
    }

    const taxConfig = await db.taxConfig.findFirst({
      where: { organizationId: tenant.organizationId },
    });

    // The discount comes off before tax, because GST is owed on what was
    // actually charged, not on the list price. A code is quoted against the
    // course, so an order that is only an extra never claims one: reserving a
    // redemption that then discounts nothing spends the code for nothing.
    const claim = promoCode?.trim() && buyingCourse
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

    const priced = priceOrder({
      lines: [
        ...(buyingCourse
          ? [
              {
                productId: product.id,
                pricingPlanId: plan.id,
                title: courseTitle,
                pricePaise: courseChargePaise,
                isPrimary: true,
              },
            ]
          : []),
        ...addons.map((a) => ({
          productId: a.productId,
          pricingPlanId: a.pricingPlanId,
          title: a.title,
          pricePaise: a.pricePaise,
          isPrimary: false,
        })),
      ],
      discountPaise,
      tax: {
        cgstPercent: taxConfig?.cgstPercent ?? 9,
        sgstPercent: taxConfig?.sgstPercent ?? 9,
        igstPercent: taxConfig?.igstPercent ?? 18,
        // No billing state is collected yet, so supply is treated as
        // intra-state. When checkout asks for one, this is the line to change.
        interState: false,
        pricesAreExclusive: taxConfig?.pricesAreExclusive ?? true,
        enabled: taxConfig?.enabled ?? true,
      },
    });

    const taxPaise = priced.taxPaise;
    const beforePoints = priced.beforePointsPaise;

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
          subtotalPaise: priced.subtotalPaise,
          discountPaise: priced.discountPaise,
          taxPaise,
          walletPaise,
          totalPaise,
          promoCodeId: claim?.promoCodeId ?? null,
          items: {
            // One row per line. The line totals are before any loyalty credit,
            // because the credit is a payment against the order rather than a
            // reduction of what each thing was sold for, and the invoice has
            // to show what each thing was sold for.
            create: priced.lines.map((l) => ({
              productId: l.productId,
              pricingPlanId: l.pricingPlanId,
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
    for (const a of addons) await rememberIntent(a.productId, a.pricingPlanId);

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

/* Checking out a whole basket ----------------------------------------------
 *
 * The function above sells one course. This one sells a basket, and the
 * difference that matters is not the loop: it is that the buyer may not have
 * an account yet.
 *
 * A student who has chosen two courses and has a card in their hand should not
 * be sent to a signup form first. So the account is created here, from what
 * they typed at checkout, and they set a password afterwards from the
 * confirmation screen. Nothing is sent to them to make that work, which is
 * deliberate: no email or SMS provider is connected yet, and a purchase that
 * depends on one would be a purchase nobody can complete.
 *
 * An address that already has an account is the one case that stops. That
 * account may hold somebody else's enrolments, and letting a stranger buy
 * their way into it for the price of a course would be a way in. Their order
 * is not created; they are asked to sign in, and their basket is waiting for
 * them when they do.
 */

export type CartCheckoutStart =
  | { ok: true; orderId: string }
  | { ok: false; error: string; signIn?: true; contactNeeded?: true };

export async function startCartCheckout(input: {
  promoCode?: string;
  usePoints?: boolean;
  contact?: GuestContact;
}): Promise<CartCheckoutStart> {
  try {
    const tenant = await requireTenant();

    if (!paymentsConfigured()) {
      return { ok: false, error: 'Online payment is not switched on yet. Please contact the academy.' };
    }

    const basket = await readBasket(tenant.organizationId);
    if (basket.lines.length === 0) {
      return {
        ok: false,
        error:
          basket.needsOwnCheckout.length > 0
            ? 'That plan is paid for on its own. Open the course and enrol from there.'
            : 'Your cart is empty.',
      };
    }

    const signedIn = await getSessionUser();
    let buyerId = signedIn?.id ?? null;
    let guestToken: string | null = null;

    if (!buyerId) {
      const contact = normaliseContact(input.contact);
      if (!contact.ok) return { ok: false, error: contact.error, contactNeeded: true };

      // Guest checkout creates an account, so it is a way to make accounts in
      // bulk if it is left open. Ten in ten minutes from one address is far
      // more than a family buying courses and far less than a script.
      const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
      const limit = checkAll(
        authAttemptKeys('guest-checkout', tenant.organizationId, contact.email, ip),
        10,
        600,
      );
      if (!limit.ok) {
        return { ok: false, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };
      }

      const existing = await db.user.findFirst({
        where: {
          organizationId: tenant.organizationId,
          deletedAt: null,
          OR: [
            ...(contact.email ? [{ email: contact.email }] : []),
            ...(contact.phone ? [{ phone: contact.phone }] : []),
          ],
        },
        select: { id: true, passwordHash: true, _count: { select: { enrollments: true } } },
      });

      if (existing && (existing.passwordHash || existing._count.enrollments > 0)) {
        return {
          ok: false,
          signIn: true,
          error:
            'There is already an account with those details. Please sign in and your cart will be waiting.',
        };
      }

      // A returning guest with no password and nothing bought yet is the same
      // person coming back, so they get their own record rather than a second.
      const buyer =
        existing ??
        (await db.user.create({
          data: {
            organizationId: tenant.organizationId,
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            kind: 'LEARNER',
            status: 'ACTIVE',
          },
          select: { id: true, passwordHash: true, _count: { select: { enrollments: true } } },
        }));

      buyerId = buyer.id;
      guestToken = (await cookies()).get(CART_COOKIE)?.value ?? null;

      if (existing) {
        await db.user.update({
          where: { id: existing.id },
          data: { name: contact.name, email: contact.email, phone: contact.phone },
        });
      }
    }

    const userId = buyerId as string;

    const branch = await db.branch.findFirst({
      where: { organizationId: tenant.organizationId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) return { ok: false, error: 'This academy has no branch configured.' };

    const taxConfig = await db.taxConfig.findFirst({
      where: { organizationId: tenant.organizationId },
    });

    // The code is quoted against one course, the dearest in the basket, and
    // claimed for that course. Spreading a course code across a basket would
    // make it worth more than it says on the campaign.
    const target = promoTarget(basket.lines);
    const claim =
      input.promoCode?.trim() && target
        ? await db
            .$transaction((tx) =>
              claimPromo(tx, {
                organizationId: tenant.organizationId,
                rawCode: input.promoCode as string,
                userId,
                productId: target.productId,
                subtotalPaise: target.pricePaise,
              }),
            )
            .catch((err: unknown) => {
              if (err instanceof PromoRefused) return err;
              throw err;
            })
        : null;

    if (claim instanceof PromoRefused) return { ok: false, error: claim.message };

    const priced = priceOrder({
      lines: basket.lines.map((l) => ({
        productId: l.productId,
        pricingPlanId: l.pricingPlanId,
        title: l.title,
        pricePaise: l.pricePaise,
        isPrimary: target ? l.productId === target.productId : false,
      })),
      discountPaise: claim?.discountPaise ?? 0,
      tax: {
        cgstPercent: taxConfig?.cgstPercent ?? 9,
        sgstPercent: taxConfig?.sgstPercent ?? 9,
        igstPercent: taxConfig?.igstPercent ?? 18,
        interState: false,
        pricesAreExclusive: taxConfig?.pricesAreExclusive ?? true,
        enabled: taxConfig?.enabled ?? true,
      },
    });

    // Points belong to an account, so a guest never spends any: there is no
    // balance to spend until the account exists, and it is created empty.
    const loyalty = await loyaltyConfig(tenant.organizationId);
    const wallet =
      input.usePoints && signedIn
        ? await db.walletAccount.findUnique({
            where: { userId },
            select: { balancePoints: true },
          })
        : null;

    const spendPoints = wallet
      ? redeemablePoints(wallet.balancePoints, priced.beforePointsPaise, loyalty)
      : 0;
    const walletPaise = pointsToPaise(spendPoints, loyalty);
    const totalPaise = Math.max(0, priced.beforePointsPaise - walletPaise);

    if (totalPaise <= 0) {
      return { ok: false, error: 'Points cannot cover the whole order. Please contact the academy.' };
    }

    const count = await db.order.count({ where: { organizationId: tenant.organizationId } });
    const orderNo = `ORD-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    const order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          organizationId: tenant.organizationId,
          branchId: branch.id,
          userId,
          orderNo,
          status: 'PENDING',
          currency: basket.currency,
          subtotalPaise: priced.subtotalPaise,
          discountPaise: priced.discountPaise,
          taxPaise: priced.taxPaise,
          walletPaise,
          totalPaise,
          promoCodeId: claim?.promoCodeId ?? null,
          // What the buyer typed, and the basket cookie that paid. The second
          // one is how the confirmation page recognises a guest as the person
          // who just paid, without a session existing yet.
          billingAddress: guestToken
            ? ({ ...input.contact, guestToken } as Prisma.InputJsonValue)
            : undefined,
          items: {
            create: priced.lines.map((l) => ({
              productId: l.productId,
              pricingPlanId: l.pricingPlanId,
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

      if (claim) {
        await tx.promoRedemption.create({
          data: {
            promoCodeId: claim.promoCodeId,
            userId,
            orderId: created.id,
            amountPaise: claim.discountPaise,
          },
        });
      }

      if (spendPoints > 0) {
        await credit({
          tx,
          userId,
          points: -spendPoints,
          reason: 'REDEMPTION',
          note: `Spent on ${created.orderNo}`,
          orderId: created.id,
        });
      }

      return created;
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
    console.error('[cart checkout]', message);
    if (message.startsWith('RAZORPAY:')) {
      return { ok: false, error: 'The payment gateway refused to start this order. Please try again.' };
    }
    return { ok: false, error: 'We could not start checkout just now. Please try again.' };
  }
}
