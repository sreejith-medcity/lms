import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { AFFILIATE_COOKIE, commissionFor, normaliseCode } from '@/lib/affiliates';

/**
 * The affiliate programme against the database: remembering who sent a
 * visitor, attaching an order to them, and moving the sale along as the
 * order is paid or refunded.
 */

/** The partner this browser arrived through, if the cookie is still there and they are active. */
export async function affiliateFromCookie(organizationId: string): Promise<{ id: string; commissionPercent: number } | null> {
  const code = (await cookies()).get(AFFILIATE_COOKIE)?.value;
  if (!code) return null;
  return db.affiliate.findFirst({
    where: { organizationId, code: normaliseCode(code), status: 'ACTIVE' },
    select: { id: true, commissionPercent: true },
  });
}

/**
 * Right after an order is written: if a partner sent this buyer, the sale
 * is theirs, pending until the money lands. A buyer who is themselves the
 * partner earns nothing on their own purchase.
 */
export async function attachAffiliateSale(organizationId: string, order: { id: string; userId: string; subtotalPaise: number; discountPaise: number }): Promise<void> {
  const affiliate = await affiliateFromCookie(organizationId);
  if (!affiliate) return;
  const self = await db.affiliate.findFirst({ where: { id: affiliate.id, userId: order.userId }, select: { id: true } });
  if (self) return;
  const { basePaise, commissionPaise } = commissionFor(order, affiliate.commissionPercent);
  if (commissionPaise <= 0) return;
  await db.affiliateSale
    .create({ data: { organizationId, affiliateId: affiliate.id, orderId: order.id, basePaise, commissionPaise, status: 'PENDING' } })
    .catch(() => null); // a second attempt on the same order keeps the first row
}

/** The order was paid: the partner's sale is approved. */
export async function approveAffiliateSale(organizationId: string, orderId: string): Promise<void> {
  await db.affiliateSale.updateMany({ where: { organizationId, orderId, status: 'PENDING' }, data: { status: 'APPROVED' } }).catch(() => null);
}

/** The order was refunded: nothing is owed on it. */
export async function voidAffiliateSale(organizationId: string, orderId: string): Promise<void> {
  await db.affiliateSale.updateMany({ where: { organizationId, orderId, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'VOID' } }).catch(() => null);
}
