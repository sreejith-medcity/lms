import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

/**
 * Points, and the rules that stop them becoming a currency.
 *
 * Loyalty credit is the one balance in the product a learner can spend, so it
 * is written as a ledger rather than a number: every change is a row with a
 * reason, and the balance is what the rows add up to. An institute that stores
 * only the balance cannot answer "why do I have 400 points", and that question
 * always arrives eventually.
 *
 * The caps matter as much as the credits. Without a ceiling on what a single
 * order can absorb, a promotion becomes free courses.
 */

export interface Loyalty {
  enabled: boolean;
  maxCreditAllowed: number;
  maxRedeemablePercent: number;
  pointToCurrencyPaise: number;
  referralSignupCredit: number;
  normalSignupCredit: number;
  referrerCredit: number;
  referralPurchaseCredit: number;
}

export const LOYALTY_DEFAULTS: Loyalty = {
  enabled: false,
  maxCreditAllowed: 20000,
  maxRedeemablePercent: 10,
  pointToCurrencyPaise: 100,
  referralSignupCredit: 1000,
  normalSignupCredit: 0,
  referrerCredit: 0,
  referralPurchaseCredit: 0,
};

export async function loyaltyConfig(organizationId: string): Promise<Loyalty> {
  const row = await db.loyaltyConfig.findUnique({ where: { organizationId } });
  return row
    ? {
        enabled: row.enabled,
        maxCreditAllowed: row.maxCreditAllowed,
        maxRedeemablePercent: row.maxRedeemablePercent,
        pointToCurrencyPaise: row.pointToCurrencyPaise,
        referralSignupCredit: row.referralSignupCredit,
        normalSignupCredit: row.normalSignupCredit,
        referrerCredit: row.referrerCredit,
        referralPurchaseCredit: row.referralPurchaseCredit,
      }
    : LOYALTY_DEFAULTS;
}

export function pointsToPaise(points: number, config: Loyalty): number {
  return Math.max(0, Math.round(points * config.pointToCurrencyPaise));
}

export function paiseToPoints(paise: number, config: Loyalty): number {
  if (config.pointToCurrencyPaise <= 0) return 0;
  return Math.floor(paise / config.pointToCurrencyPaise);
}

/** The most this order may absorb, in points: the cap, the balance, or the order. */
export function redeemablePoints(
  balancePoints: number,
  orderPaise: number,
  config: Loyalty,
): number {
  if (!config.enabled || balancePoints <= 0 || orderPaise <= 0) return 0;

  const ceilingPaise = Math.floor((orderPaise * config.maxRedeemablePercent) / 100);
  return Math.max(0, Math.min(balancePoints, paiseToPoints(ceilingPaise, config)));
}

/**
 * Move points, and say why.
 *
 * Every caller goes through here so no balance is ever written without a row
 * beside it explaining itself. The wallet is created on first use rather than
 * at signup: an empty wallet for somebody who never earned anything is a row
 * doing nothing.
 */
export async function credit(input: {
  userId: string;
  points: number;
  reason: string;
  note?: string | null;
  orderId?: string | null;
  createdById?: string | null;
  /** Refuses to take the balance past the academy's ceiling. */
  maxBalance?: number;
  tx?: Prisma.TransactionClient;
}): Promise<{ balance: number; applied: number }> {
  const client = input.tx ?? db;

  const wallet = await client.walletAccount.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, balancePoints: 0 },
    update: {},
    select: { id: true, balancePoints: true },
  });

  let points = Math.round(input.points);
  if (points > 0 && input.maxBalance != null) {
    points = Math.min(points, Math.max(0, input.maxBalance - wallet.balancePoints));
  }
  if (points < 0) {
    // Never spend more than is there, whatever the caller believed.
    points = -Math.min(-points, wallet.balancePoints);
  }
  if (points === 0) return { balance: wallet.balancePoints, applied: 0 };

  const updated = await client.walletAccount.update({
    where: { id: wallet.id },
    data: { balancePoints: { increment: points } },
    select: { balancePoints: true },
  });

  await client.walletTransaction.create({
    data: {
      walletId: wallet.id,
      points,
      reason: input.reason,
      note: input.note ?? null,
      orderId: input.orderId ?? null,
      createdById: input.createdById ?? null,
    },
  });

  return { balance: updated.balancePoints, applied: points };
}

/** A short, unambiguous code: no O/0 or I/1 to mistype over the phone. */
export function makeReferralCode(name: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const stem = name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'REF';
  let tail = '';
  for (let i = 0; i < 4; i++) {
    tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${stem}${tail}`;
}

export const REASON_LABELS: Record<string, string> = {
  SIGNUP: 'Welcome credit',
  REFERRAL_SIGNUP: 'Joined with a referral code',
  REFERRER: 'Someone joined with your code',
  REFERRAL_PURCHASE: 'Someone you referred bought a course',
  ADMIN: 'Adjusted by the academy',
  REDEMPTION: 'Spent on an order',
};

/* The moments points are earned ------------------------------------------- */

/**
 * Welcome credit, and the referral pair.
 *
 * Called at the end of signup and never allowed to fail it: somebody who cannot
 * be given points has still made an account, and throwing here would lose it.
 */
export async function creditOnSignup(input: {
  organizationId: string;
  userId: string;
  userName: string;
  referralCode?: string | null;
}): Promise<void> {
  try {
    const config = await loyaltyConfig(input.organizationId);
    if (!config.enabled) return;

    if (config.normalSignupCredit > 0) {
      await credit({
        userId: input.userId,
        points: config.normalSignupCredit,
        reason: 'SIGNUP',
        maxBalance: config.maxCreditAllowed,
      });
    }

    const code = input.referralCode?.trim().toUpperCase();
    if (!code) return;

    const referral = await db.referralCode.findUnique({
      where: { code },
      select: { id: true, userId: true },
    });
    // Referring yourself is the first thing anybody tries.
    if (!referral || referral.userId === input.userId) return;

    const referrer = await db.user.findFirst({
      where: { id: referral.userId, organizationId: input.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!referrer) return;

    await db.referral.create({
      data: {
        referralCodeId: referral.id,
        referrerId: referrer.id,
        refereeId: input.userId,
      },
    });

    if (config.referralSignupCredit > 0) {
      await credit({
        userId: input.userId,
        points: config.referralSignupCredit,
        reason: 'REFERRAL_SIGNUP',
        note: `Joined with ${code}`,
        maxBalance: config.maxCreditAllowed,
      });
    }

    if (config.referrerCredit > 0) {
      await credit({
        userId: referrer.id,
        points: config.referrerCredit,
        reason: 'REFERRER',
        note: `${input.userName} joined with your code`,
        maxBalance: config.maxCreditAllowed,
      });
    }
  } catch (err) {
    console.error('[wallet]', err instanceof Error ? err.message : err);
  }
}

/**
 * The referrer's cut when the person they brought actually pays.
 *
 * Paid once per referral, on the first purchase: the record carries
 * `purchasedAt`, and a second order finds it already set.
 */
export async function creditOnPurchase(input: {
  organizationId: string;
  userId: string;
  orderId: string;
}): Promise<void> {
  try {
    const config = await loyaltyConfig(input.organizationId);
    if (!config.enabled || config.referralPurchaseCredit <= 0) return;

    const referral = await db.referral.findUnique({
      where: { refereeId: input.userId },
      select: { id: true, referrerId: true, purchasedAt: true },
    });
    if (!referral || referral.purchasedAt) return;

    await db.referral.update({
      where: { id: referral.id },
      data: { purchasedAt: new Date() },
    });

    await credit({
      userId: referral.referrerId,
      points: config.referralPurchaseCredit,
      reason: 'REFERRAL_PURCHASE',
      note: 'Someone you referred bought a course',
      orderId: input.orderId,
      maxBalance: config.maxCreditAllowed,
    });
  } catch (err) {
    console.error('[wallet]', err instanceof Error ? err.message : err);
  }
}
