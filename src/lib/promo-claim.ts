import { Prisma } from '@prisma/client';
import { discountFor, normaliseCode, refusalMessage, type PromoRefusal } from '@/lib/promo';

/**
 * Claiming a code, as opposed to quoting one.
 *
 * Runs inside the same transaction that writes the order, and takes a row lock
 * on the code before it counts anything. Without the lock, two people pressing
 * pay in the same second both read "49 used" and both get in, which is how a
 * code stamped "first 50" ends up honoured 63 times.
 *
 * The claim is a reservation: the redemption row is written against a PENDING
 * order and released if that order fails. The alternative, claiming only once
 * money lands, means the limit can fill between the price the learner was shown
 * and the payment they made, and then somebody has to explain the difference.
 */

export type TxClient = Prisma.TransactionClient;

export interface Claim {
  promoCodeId: string;
  code: string;
  discountPaise: number;
}

export class PromoRefused extends Error {
  constructor(public reason: PromoRefusal, public minOrderPaise?: number | null) {
    super(refusalMessage(reason, minOrderPaise));
  }
}

export async function claimPromo(
  tx: TxClient,
  input: {
    organizationId: string;
    rawCode: string;
    userId: string;
    productId: string;
    subtotalPaise: number;
  },
): Promise<Claim> {
  const code = normaliseCode(input.rawCode);

  const promo = await tx.promoCode.findFirst({
    where: { organizationId: input.organizationId, code },
    select: {
      id: true,
      code: true,
      isActive: true,
      discountType: true,
      discountValue: true,
      maxDiscountPaise: true,
      minOrderPaise: true,
      maxRedemptions: true,
      perUserLimit: true,
      startsAt: true,
      endsAt: true,
      products: { select: { productId: true } },
    },
  });
  if (!promo) throw new PromoRefused('NOT_FOUND');
  if (!promo.isActive) throw new PromoRefused('INACTIVE');

  const now = new Date();
  if (promo.startsAt && promo.startsAt > now) throw new PromoRefused('NOT_STARTED');
  if (promo.endsAt && promo.endsAt < now) throw new PromoRefused('EXPIRED');
  if (promo.products.length > 0 && !promo.products.some((p) => p.productId === input.productId)) {
    throw new PromoRefused('WRONG_PRODUCT');
  }
  if (promo.minOrderPaise && input.subtotalPaise < promo.minOrderPaise) {
    throw new PromoRefused('UNDER_MINIMUM', promo.minOrderPaise);
  }

  // Everything below this line is counted while holding the code's row, so the
  // counts cannot move under us before the redemption is written.
  await tx.$queryRaw`SELECT id FROM promo_codes WHERE id = ${promo.id} FOR UPDATE`;

  if (promo.maxRedemptions != null) {
    const used = await tx.promoRedemption.count({ where: { promoCodeId: promo.id } });
    if (used >= promo.maxRedemptions) throw new PromoRefused('ALL_USED');
  }

  const mine = await tx.promoRedemption.count({
    where: { promoCodeId: promo.id, userId: input.userId },
  });
  if (mine >= promo.perUserLimit) throw new PromoRefused('ALREADY_USED');

  const discountPaise = discountFor(promo, input.subtotalPaise);
  if (discountPaise <= 0) throw new PromoRefused('UNDER_MINIMUM', promo.minOrderPaise);

  return { promoCodeId: promo.id, code: promo.code, discountPaise };
}
