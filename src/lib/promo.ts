import { toPaise } from '@/lib/money';

/**
 * What a promo code is worth on a given order.
 *
 * Kept here so the admin preview, the checkout and any later cart all compute
 * the same number. `discountValue` means a percentage when the type is PERCENT
 * and rupees when it is FLAT — the admin form is the only thing that writes it,
 * and it converts on the way in.
 */

export interface PromoLike {
  discountType: string;
  discountValue: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number | null;
}

export function discountFor(promo: PromoLike, subtotalPaise: number): number {
  const raw =
    promo.discountType === 'FLAT'
      ? toPaise(promo.discountValue)
      : Math.round((subtotalPaise * promo.discountValue) / 100);

  const capped = promo.maxDiscountPaise != null ? Math.min(raw, promo.maxDiscountPaise) : raw;

  // A discount can take an order to zero but never below it, and never turns
  // into credit the learner can spend elsewhere.
  return Math.max(0, Math.min(capped, subtotalPaise));
}

export function describeDiscount(promo: PromoLike, currency = 'INR'): string {
  const money = (paise: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
      paise / 100,
    );

  if (promo.discountType === 'FLAT') return `${money(toPaise(promo.discountValue))} off`;
  const cap = promo.maxDiscountPaise ? `, up to ${money(promo.maxDiscountPaise)}` : '';
  return `${promo.discountValue}% off${cap}`;
}

export type PromoRefusal =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'WRONG_PRODUCT'
  | 'UNDER_MINIMUM'
  | 'ALL_USED'
  | 'ALREADY_USED';

/** Said to the learner, so it explains rather than accuses. */
export function refusalMessage(reason: PromoRefusal, minOrderPaise?: number | null): string {
  switch (reason) {
    case 'NOT_FOUND':
      return 'That code does not exist. Check the spelling.';
    case 'INACTIVE':
      return 'That code is no longer being accepted.';
    case 'NOT_STARTED':
      return 'That code is not live yet.';
    case 'EXPIRED':
      return 'That code has expired.';
    case 'WRONG_PRODUCT':
      return 'That code is not valid on this course.';
    case 'UNDER_MINIMUM':
      return minOrderPaise
        ? `That code needs an order of at least ${new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
          }).format(minOrderPaise / 100)}.`
        : 'That code needs a larger order.';
    case 'ALL_USED':
      return 'That code has been fully claimed.';
    case 'ALREADY_USED':
      return 'You have already used that code.';
  }
}

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}
