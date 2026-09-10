/**
 * What may be bought together, decided away from the database.
 *
 * A basket is where a storefront quietly goes wrong: the same course added
 * twice, an extra whose course was removed, a subscription sitting beside a
 * one-off payment, something the buyer already owns. Each of those is a refund
 * conversation, and none of them is visible in a screenshot, so the rules live
 * here as plain functions over plain rows and are tested rather than trusted.
 *
 * The caller reads the rows and applies the outcome. This file never touches
 * Prisma, which is what lets it be tested at all.
 */

export type PlanType = 'ONE_TIME' | 'INSTALMENT' | 'SUBSCRIPTION' | 'FREE';

export interface BasketRow {
  itemId: string;
  productId: string;
  title: string;
  slug: string;
  /** The plan chosen when it went in, or the product's default at read time. */
  pricingPlanId: string | null;
  planType: PlanType;
  pricePaise: number;
  currency: string;
  /** Sold only alongside something else. */
  isAddonOnly: boolean;
  /** Products this one may be attached to. Empty for a course. */
  parentProductIds: string[];
  status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';
  /** The academy enrols this one by hand; it is not sold online. */
  onDemandOnly: boolean;
  thumbnailAssetId?: string | null;
}

/** Why a row was taken out, in words a buyer can act on. */
export type DropReason =
  | 'DUPLICATE'
  | 'ALREADY_ENROLLED'
  | 'UNAVAILABLE'
  | 'ADDON_WITHOUT_COURSE'
  | 'NOT_SOLD_ONLINE'
  | 'FREE'
  | 'PLAN_NEEDS_ITS_OWN_CHECKOUT';

export interface KeptLine {
  itemId: string;
  productId: string;
  pricingPlanId: string | null;
  title: string;
  slug: string;
  pricePaise: number;
  currency: string;
  isAddon: boolean;
  thumbnailAssetId?: string | null;
}

export interface DroppedLine {
  itemId: string;
  productId: string;
  title: string;
  reason: DropReason;
  /** One sentence for the cart page. */
  message: string;
}

export interface BasketReview {
  lines: KeptLine[];
  dropped: DroppedLine[];
  subtotalPaise: number;
  currency: string;
  /**
   * True when something in the basket has to be bought on its own: an
   * instalment schedule or a subscription. Merging two schedules into one
   * payment is not a rounding problem, it is two different contracts, so the
   * cart says so rather than quietly charging the first instalment of both.
   */
  needsOwnCheckout: DroppedLine[];
}

const MESSAGES: Record<DropReason, string> = {
  DUPLICATE: 'Already in your cart once.',
  ALREADY_ENROLLED: 'You are already enrolled in this.',
  UNAVAILABLE: 'No longer on sale.',
  ADDON_WITHOUT_COURSE: 'Only sold alongside its course. Add the course to keep it.',
  NOT_SOLD_ONLINE: 'The academy enrols this one directly. Please contact them.',
  FREE: 'This one is free. Enrol from the course page.',
  PLAN_NEEDS_ITS_OWN_CHECKOUT:
    'Instalment and subscription plans are paid for on their own, not alongside other courses.',
};

/**
 * Reduce a basket to what can actually be charged in one payment.
 *
 * Order matters. Duplicates go first so a second copy is never the row that
 * keeps an extra alive; extras are judged last, against the courses that
 * survived, so removing a course removes its add-on with it.
 */
export function reviewBasket(
  rows: BasketRow[],
  options: { enrolledProductIds?: string[]; currency?: string } = {},
): BasketReview {
  const enrolled = new Set(options.enrolledProductIds ?? []);
  const dropped: DroppedLine[] = [];
  const drop = (row: BasketRow, reason: DropReason) =>
    dropped.push({
      itemId: row.itemId,
      productId: row.productId,
      title: row.title,
      reason,
      message: MESSAGES[reason],
    });

  const seen = new Set<string>();
  const firstPass: BasketRow[] = [];

  for (const row of rows) {
    if (seen.has(row.productId)) {
      drop(row, 'DUPLICATE');
      continue;
    }
    seen.add(row.productId);

    if (row.status !== 'PUBLISHED') {
      drop(row, 'UNAVAILABLE');
      continue;
    }
    if (row.onDemandOnly) {
      drop(row, 'NOT_SOLD_ONLINE');
      continue;
    }
    if (enrolled.has(row.productId)) {
      drop(row, 'ALREADY_ENROLLED');
      continue;
    }
    if (row.planType === 'FREE' || row.pricePaise <= 0) {
      drop(row, 'FREE');
      continue;
    }

    firstPass.push(row);
  }

  // A schedule cannot be merged with another schedule, so these leave the
  // basket and are reported separately: the buyer is told to check out that
  // one on its own rather than finding it silently missing.
  const needsOwnCheckout: DroppedLine[] = [];
  const payableNow = firstPass.filter((row) => {
    if (row.planType === 'INSTALMENT' || row.planType === 'SUBSCRIPTION') {
      const entry: DroppedLine = {
        itemId: row.itemId,
        productId: row.productId,
        title: row.title,
        reason: 'PLAN_NEEDS_ITS_OWN_CHECKOUT',
        message: MESSAGES.PLAN_NEEDS_ITS_OWN_CHECKOUT,
      };
      needsOwnCheckout.push(entry);
      return false;
    }
    return true;
  });

  const courseIds = new Set(payableNow.filter((r) => !r.isAddonOnly).map((r) => r.productId));

  const lines: KeptLine[] = [];
  for (const row of payableNow) {
    if (row.isAddonOnly && !row.parentProductIds.some((id) => courseIds.has(id))) {
      drop(row, 'ADDON_WITHOUT_COURSE');
      continue;
    }
    lines.push({
      itemId: row.itemId,
      productId: row.productId,
      pricingPlanId: row.pricingPlanId,
      title: row.title,
      slug: row.slug,
      pricePaise: row.pricePaise,
      currency: row.currency,
      isAddon: row.isAddonOnly,
      thumbnailAssetId: row.thumbnailAssetId ?? null,
    });
  }

  return {
    lines,
    dropped,
    needsOwnCheckout,
    subtotalPaise: lines.reduce((sum, l) => sum + l.pricePaise, 0),
    currency: lines[0]?.currency ?? options.currency ?? 'INR',
  };
}

/**
 * Which course a promo code should be quoted against.
 *
 * A code is written for a course, not for a basket, so with several in the
 * cart the dearest one is the fairest reading of "this code applies here":
 * it is the one the buyer most likely came with the code for, and quoting the
 * cheapest would make a percentage code look broken.
 */
export function promoTarget(lines: KeptLine[]): KeptLine | null {
  const courses = lines.filter((l) => !l.isAddon);
  if (courses.length === 0) return null;
  return courses.reduce((best, line) => (line.pricePaise > best.pricePaise ? line : best));
}
