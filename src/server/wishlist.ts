'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { WISH_COOKIE, parseWishCookie, serialiseWishCookie, toggleId } from '@/lib/wishlist-cookie';

/**
 * Save a course for later. A guest's list lives in the cookie; a signed-in
 * learner's lives in the database as well, and the two are merged the
 * first time they open the list signed in.
 */

async function writeCookie(ids: string[]) {
  const jar = await cookies();
  jar.set(WISH_COOKIE, serialiseWishCookie(ids), { path: '/', maxAge: 180 * 86400, sameSite: 'lax', httpOnly: false });
}

export async function toggleWish(productId: string): Promise<{ saved: boolean; count: number; error?: string }> {
  const tenant = await requireTenant();
  const product = await db.product.findFirst({
    where: { id: productId, organizationId: tenant.organizationId, status: 'PUBLISHED', deletedAt: null, isAddonOnly: false },
    select: { id: true },
  });
  const jar = await cookies();
  const current = parseWishCookie(jar.get(WISH_COOKIE)?.value);
  if (!product) return { saved: false, count: current.length, error: 'That course is not available.' };

  const next = toggleId(current, product.id);
  await writeCookie(next.ids);

  const user = await getSessionUser();
  if (user && user.organizationId === tenant.organizationId) {
    if (next.saved) {
      await db.wishlist.upsert({
        where: { userId_productId: { userId: user.id, productId: product.id } },
        create: { organizationId: tenant.organizationId, userId: user.id, productId: product.id },
        update: {},
      });
    } else {
      await db.wishlist.deleteMany({ where: { userId: user.id, productId: product.id, organizationId: tenant.organizationId } });
    }
    revalidatePath('/learn/wishlist');
  }
  return { saved: next.saved, count: next.ids.length };
}

/** Merge the cookie into the account, and hand back the account's list. */
export async function syncWishlist(): Promise<string[]> {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  const jar = await cookies();
  const fromCookie = parseWishCookie(jar.get(WISH_COOKIE)?.value);
  if (!user || user.organizationId !== tenant.organizationId) return fromCookie;

  const existing = await db.wishlist.findMany({ where: { userId: user.id, organizationId: tenant.organizationId }, select: { productId: true } });
  const have = new Set(existing.map((e) => e.productId));
  const missing = fromCookie.filter((id) => !have.has(id));
  if (missing.length) {
    const valid = await db.product.findMany({
      where: { id: { in: missing }, organizationId: tenant.organizationId, status: 'PUBLISHED', deletedAt: null },
      select: { id: true },
    });
    if (valid.length) {
      await db.wishlist.createMany({ data: valid.map((v) => ({ organizationId: tenant.organizationId, userId: user.id, productId: v.id })), skipDuplicates: true });
    }
  }
  const all = await db.wishlist.findMany({ where: { userId: user.id, organizationId: tenant.organizationId }, orderBy: { createdAt: 'desc' }, select: { productId: true } });
  const ids = all.map((a) => a.productId);
  await writeCookie(ids);
  return ids;
}
