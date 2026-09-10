import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { reviewBasket, type BasketRow, type BasketReview } from '@/lib/cart-rules';
import { CART_COOKIE, CART_COUNT_COOKIE } from '@/lib/cart-cookie';

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

/* The basket a visitor actually fills ---------------------------------------
 *
 * Everything above this line is the office's view of a cart: a record that
 * somebody stood at the till, kept so they can be followed up. Everything
 * below is the till itself, added when the storefront grew a real basket.
 *
 * They share one table on purpose. A cart is a cart whether the person came
 * back to it or not, and keeping two would mean an abandoned basket and a
 * recovery list that disagree about what was in it.
 */

/**
 * The cookie names live in `cart-cookie.ts`, which has no imports, because
 * client components read them and this module reaches for node:crypto.
 */
export { CART_COOKIE, CART_COUNT_COOKIE } from '@/lib/cart-cookie';

const CART_DAYS = 30;

async function readToken(): Promise<string | null> {
  return (await cookies()).get(CART_COOKIE)?.value ?? null;
}

/**
 * Only ever called from a server action or a route handler. A page cannot set
 * a cookie during render, which is why nothing here is called from one.
 */
async function issueToken(): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  (await cookies()).set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CART_DAYS * 86400,
  });
  return token;
}

/** The open cart for whoever is asking, or null when they have never had one. */
export async function findBasket(organizationId: string): Promise<{ id: string } | null> {
  const user = await getSessionUser();
  const token = await readToken();

  if (!user && !token) return null;

  return db.cart.findFirst({
    where: {
      organizationId,
      status: { in: ['OPEN', 'ABANDONED'] },
      ...(user ? { userId: user.id } : { guestToken: token as string }),
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
}

async function openBasket(organizationId: string): Promise<string> {
  const existing = await findBasket(organizationId);
  if (existing) return existing.id;

  const user = await getSessionUser();
  const token = user ? null : ((await readToken()) ?? (await issueToken()));

  const created = await db.cart.create({
    data: {
      organizationId,
      userId: user?.id ?? null,
      guestToken: token,
      status: 'OPEN',
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * The basket as rows the rules can judge.
 *
 * The price is read now rather than remembered from when the item went in. A
 * basket left for a week should charge today's price, and the alternative is a
 * storefront that honours a figure nobody set.
 */
export async function basketRows(organizationId: string): Promise<BasketRow[]> {
  const cart = await findBasket(organizationId);
  if (!cart) return [];

  const items = await db.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      productId: true,
      pricingPlanId: true,
      product: {
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          isAddonOnly: true,
          deletedAt: true,
          course: { select: { onDemandOnly: true, thumbnailAssetId: true } },
          pricingPlans: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, planType: true, pricePaise: true, currency: true },
          },
          offeredWith: {
            where: { isActive: true },
            select: { productId: true },
          },
        },
      },
    },
  });

  const rows: BasketRow[] = [];

  for (const item of items) {
    const p = item.product;
    const plan = p.pricingPlans.find((pl) => pl.id === item.pricingPlanId) ?? p.pricingPlans[0];

    rows.push({
      itemId: item.id,
      productId: p.id,
      title: p.title,
      slug: p.slug,
      pricingPlanId: plan?.id ?? null,
      planType: (plan?.planType ?? 'FREE') as BasketRow['planType'],
      pricePaise: plan?.pricePaise ?? 0,
      currency: plan?.currency ?? 'INR',
      isAddonOnly: p.isAddonOnly,
      parentProductIds: p.offeredWith.map((o) => o.productId),
      status: p.deletedAt ? 'ARCHIVED' : (p.status as BasketRow['status']),
      onDemandOnly: p.course?.onDemandOnly ?? false,
      thumbnailAssetId: p.course?.thumbnailAssetId ?? null,
    });
  }

  return rows;
}

/** The basket, already judged: what is payable, and what was taken out and why. */
export async function readBasket(organizationId: string): Promise<BasketReview> {
  const rows = await basketRows(organizationId);
  if (rows.length === 0) return reviewBasket([]);

  const user = await getSessionUser();
  const enrolled = user
    ? await db.enrollment.findMany({
        where: {
          organizationId,
          userId: user.id,
          productId: { in: rows.map((r) => r.productId) },
          status: { notIn: ['CANCELLED', 'ARCHIVED', 'EXPIRED'] },
        },
        select: { productId: true },
      })
    : [];

  return reviewBasket(rows, { enrolledProductIds: enrolled.map((e) => e.productId) });
}

export type AddOutcome = 'added' | 'already-in' | 'unavailable' | 'owned' | 'free';

/** Put something in the basket. Called only from a server action. */
export async function addToBasket(
  organizationId: string,
  productId: string,
  pricingPlanId?: string,
): Promise<AddOutcome> {
  const product = await db.product.findFirst({
    where: { id: productId, organizationId, status: 'PUBLISHED', deletedAt: null },
    select: {
      id: true,
      course: { select: { onDemandOnly: true } },
      pricingPlans: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, planType: true, pricePaise: true },
      },
    },
  });
  if (!product || product.course?.onDemandOnly) return 'unavailable';

  const plan = product.pricingPlans.find((p) => p.id === pricingPlanId) ?? product.pricingPlans[0];
  if (!plan || plan.pricePaise <= 0 || plan.planType === 'FREE') return 'free';

  const user = await getSessionUser();
  if (user) {
    const owned = await db.enrollment.findFirst({
      where: {
        organizationId,
        userId: user.id,
        productId,
        status: { notIn: ['CANCELLED', 'ARCHIVED', 'EXPIRED'] },
      },
      select: { id: true },
    });
    if (owned) return 'owned';
  }

  const cartId = await openBasket(organizationId);

  const existing = await db.cartItem.findFirst({
    where: { cartId, productId },
    select: { id: true },
  });
  if (existing) {
    // Adding the same course again is not an error and not a second copy. It
    // does mean the plan may have changed, so the choice is updated.
    await db.cartItem.update({ where: { id: existing.id }, data: { pricingPlanId: plan.id } });
    return 'already-in';
  }

  await db.cartItem.create({ data: { cartId, productId, pricingPlanId: plan.id } });
  await db.cart.update({
    where: { id: cartId },
    data: { status: 'OPEN', abandonedAt: null },
  });

  return 'added';
}

export async function removeFromBasket(organizationId: string, itemId: string): Promise<void> {
  const cart = await findBasket(organizationId);
  if (!cart) return;
  await db.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
}

export async function emptyBasket(organizationId: string): Promise<void> {
  const cart = await findBasket(organizationId);
  if (!cart) return;
  await db.cartItem.deleteMany({ where: { cartId: cart.id } });
}

/** How many payable lines are in it. Cheap enough to call after every change. */
export async function basketCount(organizationId: string): Promise<number> {
  const review = await readBasket(organizationId);
  return review.lines.length;
}

/**
 * Write the count where the header can read it.
 *
 * Set to "0" rather than deleted, so a browser holding a stale number is
 * corrected rather than left showing it.
 */
export async function publishBasketCount(organizationId: string): Promise<number> {
  const count = await basketCount(organizationId);
  (await cookies()).set(CART_COUNT_COOKIE, String(count), {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CART_DAYS * 86400,
  });
  return count;
}

/**
 * Carry a basket across the sign-in door.
 *
 * Somebody who filled a basket, then signed in to pay, must not arrive at an
 * empty cart. Their guest basket is adopted, and anything already in their
 * account's basket is kept alongside it rather than overwritten.
 */
export async function adoptGuestBasket(organizationId: string, userId: string): Promise<void> {
  try {
    const token = await readToken();
    if (!token) return;

    const guest = await db.cart.findFirst({
      where: { organizationId, guestToken: token, status: { in: ['OPEN', 'ABANDONED'] } },
      select: { id: true, items: { select: { productId: true, pricingPlanId: true } } },
    });
    if (!guest) return;

    if (guest.items.length > 0) {
      const mine = await db.cart.findFirst({
        where: { organizationId, userId, status: { in: ['OPEN', 'ABANDONED'] } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, items: { select: { productId: true } } },
      });

      if (!mine) {
        // Nothing of their own to merge into: the guest cart simply becomes
        // theirs, which also keeps its visit count and its history.
        await db.cart.update({
          where: { id: guest.id },
          data: { userId, guestToken: null, status: 'OPEN', abandonedAt: null },
        });
        (await cookies()).delete(CART_COOKIE);
        return;
      }

      const have = new Set(mine.items.map((i) => i.productId));
      const incoming = guest.items.filter((i) => !have.has(i.productId));
      if (incoming.length > 0) {
        await db.cartItem.createMany({
          data: incoming.map((i) => ({
            cartId: mine.id,
            productId: i.productId,
            pricingPlanId: i.pricingPlanId,
          })),
        });
        await db.cart.update({
          where: { id: mine.id },
          data: { status: 'OPEN', abandonedAt: null },
        });
      }
    }

    await db.cart.delete({ where: { id: guest.id } });
    (await cookies()).delete(CART_COOKIE);
  } catch (err) {
    // Never the reason a sign-in fails.
    console.error('[cart] adopting the guest basket', err instanceof Error ? err.message : err);
  }
}

/**
 * The count for one account, written straight after a sign-in.
 *
 * `publishBasketCount` asks who is signed in, and inside the request that is
 * signing somebody in that answer may still be the old one. This takes the
 * user it was given and counts their rows, so the badge is right the moment
 * they land.
 */
export async function publishBasketCountForUser(
  organizationId: string,
  userId: string,
): Promise<void> {
  try {
    const cart = await db.cart.findFirst({
      where: { organizationId, userId, status: { in: ['OPEN', 'ABANDONED'] } },
      orderBy: { updatedAt: 'desc' },
      select: { _count: { select: { items: true } } },
    });

    (await cookies()).set(CART_COUNT_COOKIE, String(cart?._count.items ?? 0), {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: CART_DAYS * 86400,
    });
  } catch (err) {
    console.error('[cart] count after sign-in', err instanceof Error ? err.message : err);
  }
}
