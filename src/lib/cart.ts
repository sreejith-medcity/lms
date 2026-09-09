import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';

/**
 * The cart, kept for the sake of the ones who did not buy.
 *
 * There is no multi-item basket yet, so this is not a shopping cart in the
 * supermarket sense: it is a record that somebody stood at the till. That is
 * the part with commercial value, because a learner who reached checkout three
 * times and never paid is the most qualified lead an academy has, and in the
 * incumbent that fact is simply lost.
 *
 * These three are plain functions rather than server actions on purpose. Two of
 * them take an organisation id, and anything exported from a `'use server'`
 * file is a public endpoint: `markCartConverted(someOtherOrg, someUser)` would
 * be a stranger's to call.
 */

/** How long an untouched cart waits before it counts as abandoned. */
export const ABANDON_AFTER_HOURS = 6;

/**
 * Called when someone opens checkout. Deliberately quiet: it must never be the
 * reason a purchase fails, so every error here is swallowed.
 */
export async function rememberIntent(productId: string, pricingPlanId?: string): Promise<void> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return;

    const product = await db.product.findFirst({
      where: { id: productId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!product) return;

    const open = await db.cart.findFirst({
      where: {
        organizationId: tenant.organizationId,
        userId: user.id,
        status: { in: ['OPEN', 'ABANDONED'] },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, status: true, items: { select: { id: true, productId: true } } },
    });

    if (!open) {
      await db.cart.create({
        data: {
          organizationId: tenant.organizationId,
          userId: user.id,
          status: 'OPEN',
          items: { create: { productId: product.id, pricingPlanId: pricingPlanId ?? null } },
        },
      });
      return;
    }

    // Coming back is the signal worth counting, so a returning visit reopens the
    // cart and bumps the count rather than making a second row.
    await db.cart.update({
      where: { id: open.id },
      data: {
        status: 'OPEN',
        abandonedAt: null,
        visitCount: { increment: 1 },
        ...(open.items.some((i) => i.productId === product.id)
          ? {}
          : { items: { create: { productId: product.id, pricingPlanId: pricingPlanId ?? null } } }),
      },
    });
  } catch (err) {
    console.error('[cart]', err instanceof Error ? err.message : err);
  }
}

/**
 * Ages carts that have gone quiet.
 *
 * Run when the list is read rather than on a schedule, because there is no
 * scheduler yet and a cart's status only matters at the moment somebody looks.
 */
export async function sweepAbandonedCarts(organizationId: string): Promise<number> {
  const cutoff = new Date(Date.now() - ABANDON_AFTER_HOURS * 3600_000);

  const result = await db.cart.updateMany({
    where: { organizationId, status: 'OPEN', updatedAt: { lt: cutoff } },
    data: { status: 'ABANDONED', abandonedAt: new Date() },
  });
  return result.count;
}

/** Marks anything this learner was carrying as bought. */
export async function markCartConverted(organizationId: string, userId: string): Promise<void> {
  try {
    await db.cart.updateMany({
      where: { organizationId, userId, status: { in: ['OPEN', 'ABANDONED'] } },
      data: { status: 'CONVERTED', recoveredAt: new Date() },
    });
  } catch (err) {
    console.error('[cart]', err instanceof Error ? err.message : err);
  }
}
