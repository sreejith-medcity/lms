import { db } from '@/lib/db';
import { formatMoney } from '@/lib/money';

/**
 * Add-ons: one product offered as a tick box on another.
 *
 * The pairing lives in the database rather than in the code, which is the
 * whole point. The first case is a bought-in NCLEX question bank offered
 * alongside the NCLEX course, and if that were hardcoded then the next
 * institute on this platform could not offer anything alongside anything.
 *
 * Two rules hold this together, and both are enforced here rather than
 * trusted to the browser:
 *
 *   the price of an add-on is read from the add-on's own active plan, so a
 *   bundle can never quote a figure the product itself does not have, and
 *
 *   an add-on can only be bought through a parent it has been attached to, so
 *   a crafted request cannot staple an expensive product onto a cheap course.
 */

export interface OfferedAddon {
  /** The row, so a selection can be checked against what was offered. */
  id: string;
  productId: string;
  title: string;
  label: string;
  note: string | null;
  isPreselected: boolean;
  pricePaise: number;
  pricingPlanId: string;
  currency: string;
  /** For the tick box: "+₹12,000". */
  priceLabel: string;
}

/**
 * What may be ticked alongside this product.
 *
 * An add-on with no active plan is left out rather than shown at zero: a free
 * tick box that was meant to cost twelve thousand rupees is the kind of bug
 * that only shows up in the day's takings.
 */
export async function addonsFor(
  organizationId: string,
  productId: string,
): Promise<OfferedAddon[]> {
  const rows = await db.productAddon.findMany({
    where: {
      organizationId,
      productId,
      isActive: true,
      addonProduct: { status: 'PUBLISHED', deletedAt: null },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      label: true,
      note: true,
      isPreselected: true,
      addonProduct: {
        select: {
          id: true,
          title: true,
          pricingPlans: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            take: 1,
            select: { id: true, pricePaise: true, currency: true },
          },
        },
      },
    },
  });

  const out: OfferedAddon[] = [];
  for (const row of rows) {
    const plan = row.addonProduct.pricingPlans[0];
    if (!plan || plan.pricePaise <= 0) continue;

    out.push({
      id: row.id,
      productId: row.addonProduct.id,
      title: row.addonProduct.title,
      label: row.label ?? `Add ${row.addonProduct.title}`,
      note: row.note,
      isPreselected: row.isPreselected,
      pricePaise: plan.pricePaise,
      pricingPlanId: plan.id,
      currency: plan.currency,
      priceLabel: `+${formatMoney(plan.pricePaise, plan.currency)}`,
    });
  }
  return out;
}

/**
 * Turn what the browser asked for into what it is actually allowed to buy.
 *
 * Anything not on offer for this parent is dropped silently rather than
 * refused: the honest failure mode for a stale page is the course without the
 * extra, not an error the buyer cannot act on. Anything already owned is
 * dropped too, so nobody pays twice for the same question bank.
 */
export async function resolveSelectedAddons(input: {
  organizationId: string;
  userId: string;
  productId: string;
  requested: string[];
}): Promise<OfferedAddon[]> {
  const wanted = new Set(input.requested.filter(Boolean));
  if (wanted.size === 0) return [];

  const offered = (await addonsFor(input.organizationId, input.productId)).filter((a) =>
    wanted.has(a.productId),
  );
  if (offered.length === 0) return [];

  const owned = await db.enrollment.findMany({
    where: {
      organizationId: input.organizationId,
      userId: input.userId,
      productId: { in: offered.map((a) => a.productId) },
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
    },
    select: { productId: true },
  });

  const has = new Set(owned.map((e) => e.productId));
  return offered.filter((a) => !has.has(a.productId));
}
