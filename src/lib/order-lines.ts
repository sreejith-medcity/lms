import { computeTax, type TaxInput } from '@/lib/money';

/**
 * The arithmetic behind an order with more than one line on it.
 *
 * Checkout used to price exactly one thing, so the order total and the single
 * line's total were the same number and nothing had to be divided. An add-on
 * changes that: one tax figure now has to land on two or three lines and the
 * lines have to add back up to the order, to the paise, or the invoice is
 * wrong and the GST return is wrong with it.
 *
 * Rounding is where that goes wrong. Tax on 45,000 and tax on 5,900 computed
 * separately and added together is not always tax on 50,900, so the tax is
 * computed once on the whole taxable amount and then handed out by largest
 * remainder. The lines always sum to the total, and the odd paise goes to the
 * biggest line rather than to whichever one happened to be first.
 *
 * Pure on purpose: it takes numbers and returns numbers, so it can be tested
 * without a database, a tenant or a payment gateway.
 */

export interface DraftLine {
  productId: string;
  pricingPlanId: string | null;
  title: string;
  pricePaise: number;
  /** The course being bought. Everything else on the order is an extra. */
  isPrimary: boolean;
}

export interface PricedLine extends DraftLine {
  discountPaise: number;
  taxPaise: number;
  /** What this line is worth before any loyalty credit is applied. */
  totalPaise: number;
}

export interface OrderMaths {
  lines: PricedLine[];
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  /** The payable figure before loyalty points come off it. */
  beforePointsPaise: number;
}

/**
 * Hand `amount` out across `weights`, keeping the sum exact.
 *
 * Every share is floored first, which always leaves a few paise over, and
 * those go to the lines with the largest fractional part. Ties go to the
 * earlier line, so the answer does not depend on sort stability.
 */
export function allocate(amount: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const total = weights.reduce((n, w) => n + w, 0);

  // Nothing to weigh by: put it all on the first line rather than dividing by
  // zero or silently dropping it.
  if (total <= 0) return weights.map((_, i) => (i === 0 ? amount : 0));

  const exact = weights.map((w) => (amount * w) / total);
  const out = exact.map((v) => Math.floor(v));
  let left = amount - out.reduce((n, v) => n + v, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; left > 0 && k < order.length; k += 1, left -= 1) {
    out[order[k].i] += 1;
  }

  return out;
}

export function priceOrder(input: {
  lines: DraftLine[];
  /** Claimed against the primary line, and never more than that line is worth. */
  discountPaise: number;
  tax: Omit<TaxInput, 'amountPaise'> & { enabled: boolean };
}): OrderMaths {
  const lines = input.lines;
  const subtotalPaise = lines.reduce((n, l) => n + l.pricePaise, 0);

  // A promo code is quoted against the course somebody chose it for. It does
  // not spread onto an extra they ticked afterwards, which is both what a
  // buyer expects and what keeps a code from being worth more than it says.
  const primary = lines.find((l) => l.isPrimary);
  const discountPaise = Math.max(0, Math.min(input.discountPaise, primary?.pricePaise ?? 0));

  const perLineDiscount = lines.map((l) => (l === primary ? discountPaise : 0));
  const netPrices = lines.map((l, i) => l.pricePaise - perLineDiscount[i]);
  const netTotal = netPrices.reduce((n, v) => n + v, 0);

  const breakup = computeTax({ ...input.tax, amountPaise: netTotal });

  // With tax-inclusive pricing the displayed price is the authority and the
  // tax is carved out of it, so the gross is what the buyer was shown. It has
  // to be taken rather than recomputed: dividing by 1.18 and multiplying back
  // does not always land on the same paise, and charging a rupee's hundredth
  // more than the page said is not a rounding detail to a buyer or an auditor.
  const grossTotal = !input.tax.enabled
    ? netTotal
    : input.tax.pricesAreExclusive
      ? breakup.totalPaise
      : netTotal;

  const taxPaise = input.tax.enabled ? grossTotal - breakup.taxablePaise : 0;

  const perLineTax = allocate(taxPaise, netPrices);
  const perLineGross = allocate(grossTotal, netPrices);

  return {
    lines: lines.map((l, i) => ({
      ...l,
      discountPaise: perLineDiscount[i],
      taxPaise: perLineTax[i],
      totalPaise: perLineGross[i],
    })),
    subtotalPaise,
    discountPaise,
    taxPaise,
    beforePointsPaise: grossTotal,
  };
}
