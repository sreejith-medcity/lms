'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { priceOrder } from '@/lib/order-lines';
import { promoTarget } from '@/lib/cart-rules';
import { loyaltyConfig, pointsToPaise, redeemablePoints } from '@/lib/wallet';
import { quotePromoCode } from '@/server/promo';
import {
  addToBasket,
  emptyBasket,
  publishBasketCount,
  readBasket,
  removeFromBasket,
  type AddOutcome,
} from '@/lib/cart';

/**
 * The three things a shopper presses.
 *
 * The office's side of a cart lives in `src/server/cart.ts`, which is the
 * abandoned-basket recovery list. This file is the shopper's side, and it is
 * separate because the two have nothing in common but a table: one is guarded
 * by a staff permission, the other is open to a stranger with no account.
 *
 * Nothing here takes a price, a total or an organisation id. It takes product
 * ids, resolves the tenant from the hostname, and reads every figure from the
 * database, so a crafted request can put something in a basket but can never
 * decide what it costs.
 */

export interface BasketResult {
  ok: boolean;
  outcome?: AddOutcome;
  count: number;
  message?: string;
}

const MESSAGES: Record<AddOutcome, string> = {
  added: 'Added to your cart.',
  'already-in': 'That is already in your cart.',
  unavailable: 'That course is not on sale at the moment.',
  owned: 'You are already enrolled in that one.',
  free: 'That course is free. Enrol from the course page.',
};

export async function addItemToCart(
  productId: string,
  pricingPlanId?: string,
): Promise<BasketResult> {
  try {
    const tenant = await requireTenant();
    const outcome = await addToBasket(tenant.organizationId, String(productId), pricingPlanId);
    const count = await publishBasketCount(tenant.organizationId);

    revalidatePath('/cart');
    return {
      ok: outcome === 'added' || outcome === 'already-in',
      outcome,
      count,
      message: MESSAGES[outcome],
    };
  } catch (err) {
    console.error('[basket]', err instanceof Error ? err.message : err);
    return { ok: false, count: 0, message: 'We could not add that just now. Please try again.' };
  }
}

export async function removeItemFromCart(itemId: string): Promise<BasketResult> {
  try {
    const tenant = await requireTenant();
    await removeFromBasket(tenant.organizationId, String(itemId));
    const count = await publishBasketCount(tenant.organizationId);

    revalidatePath('/cart');
    return { ok: true, count };
  } catch (err) {
    console.error('[basket]', err instanceof Error ? err.message : err);
    return { ok: false, count: 0, message: 'We could not update your cart. Please try again.' };
  }
}

export async function emptyCart(): Promise<BasketResult> {
  try {
    const tenant = await requireTenant();
    await emptyBasket(tenant.organizationId);
    const count = await publishBasketCount(tenant.organizationId);

    revalidatePath('/cart');
    return { ok: true, count };
  } catch (err) {
    console.error('[basket]', err instanceof Error ? err.message : err);
    return { ok: false, count: 0, message: 'We could not update your cart. Please try again.' };
  }
}

/* What the cart page shows -------------------------------------------------
 *
 * The same arithmetic checkout will do, run read-only, so the figure on the
 * cart page and the figure Razorpay is asked for come from one function
 * rather than two that agree until one of them is edited.
 */

export interface CartQuoteLine {
  itemId: string;
  productId: string;
  title: string;
  slug: string;
  pricePaise: number;
  isAddon: boolean;
  thumbnailAssetId: string | null;
}

export interface CartQuote {
  lines: CartQuoteLine[];
  /** Taken out of the basket, each with a sentence saying why. */
  dropped: { itemId: string; title: string; message: string }[];
  /** Still in the cart, but has to be paid for on its own. */
  needsOwnCheckout: { itemId: string; productId: string; title: string; message: string }[];
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  currency: string;
  taxIncluded: boolean;
  promo?: { code: string; discountPaise: number };
  promoError?: string;
  /** What this learner's points could take off, if they are signed in. */
  pointsWorthPaise: number;
  pointsApplied: number;
  signedIn: boolean;
  count: number;
}

export async function quoteCart(options: {
  promoCode?: string;
  usePoints?: boolean;
} = {}): Promise<CartQuote> {
  const tenant = await requireTenant();
  const basket = await readBasket(tenant.organizationId);
  const user = await getSessionUser();

  const empty: CartQuote = {
    lines: [],
    dropped: basket.dropped.map((d) => ({ itemId: d.itemId, title: d.title, message: d.message })),
    needsOwnCheckout: basket.needsOwnCheckout.map((d) => ({
      itemId: d.itemId,
      productId: d.productId,
      title: d.title,
      message: d.message,
    })),
    subtotalPaise: 0,
    discountPaise: 0,
    taxPaise: 0,
    totalPaise: 0,
    currency: basket.currency,
    taxIncluded: false,
    pointsWorthPaise: 0,
    pointsApplied: 0,
    signedIn: Boolean(user),
    count: 0,
  };

  if (basket.lines.length === 0) return empty;

  const target = promoTarget(basket.lines);
  let promo: { code: string; discountPaise: number } | undefined;
  let promoError: string | undefined;

  if (options.promoCode?.trim() && target) {
    const quote = await quotePromoCode(options.promoCode, target.productId, target.pricePaise);
    if (quote.ok && quote.code && quote.discountPaise != null) {
      promo = { code: quote.code, discountPaise: quote.discountPaise };
    } else {
      promoError = quote.error;
    }
  }

  const taxConfig = await db.taxConfig.findFirst({ where: { organizationId: tenant.organizationId } });

  const priced = priceOrder({
    lines: basket.lines.map((l) => ({
      productId: l.productId,
      pricingPlanId: l.pricingPlanId,
      title: l.title,
      pricePaise: l.pricePaise,
      isPrimary: target ? l.productId === target.productId : false,
    })),
    discountPaise: promo?.discountPaise ?? 0,
    tax: {
      cgstPercent: taxConfig?.cgstPercent ?? 9,
      sgstPercent: taxConfig?.sgstPercent ?? 9,
      igstPercent: taxConfig?.igstPercent ?? 18,
      interState: false,
      pricesAreExclusive: taxConfig?.pricesAreExclusive ?? true,
      enabled: taxConfig?.enabled ?? true,
    },
  });

  const loyalty = await loyaltyConfig(tenant.organizationId);
  const wallet = user
    ? await db.walletAccount.findUnique({
        where: { userId: user.id },
        select: { balancePoints: true },
      })
    : null;

  const spendable = wallet
    ? redeemablePoints(wallet.balancePoints, priced.beforePointsPaise, loyalty)
    : 0;
  const pointsApplied = options.usePoints ? spendable : 0;
  const walletPaise = pointsToPaise(pointsApplied, loyalty);

  return {
    lines: basket.lines.map((l) => ({
      itemId: l.itemId,
      productId: l.productId,
      title: l.title,
      slug: l.slug,
      pricePaise: l.pricePaise,
      isAddon: l.isAddon,
      thumbnailAssetId: l.thumbnailAssetId ?? null,
    })),
    dropped: empty.dropped,
    needsOwnCheckout: empty.needsOwnCheckout,
    subtotalPaise: priced.subtotalPaise,
    discountPaise: priced.discountPaise,
    taxPaise: priced.taxPaise,
    totalPaise: Math.max(0, priced.beforePointsPaise - walletPaise),
    currency: basket.currency,
    taxIncluded: (taxConfig?.enabled ?? true) && !(taxConfig?.pricesAreExclusive ?? true),
    promo,
    promoError,
    pointsWorthPaise: pointsToPaise(spendable, loyalty),
    pointsApplied,
    signedIn: Boolean(user),
    count: basket.lines.length,
  };
}
