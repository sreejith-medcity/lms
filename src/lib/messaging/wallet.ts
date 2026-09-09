import { db } from '@/lib/db';

/**
 * The utility wallet.
 *
 * Messaging costs real money and the bill arrives weeks later, so an institute
 * that cannot see the balance finds out it ran dry from a parent asking why
 * nobody told them the class moved. The balance is a number on a screen, every
 * message writes a ledger row, and the drain refuses to send below the floor
 * rather than quietly going negative.
 *
 * Email is usually priced at zero, and a zero row is still written, because
 * "how many did we send this month" is a question worth being able to answer.
 */

export interface WalletState {
  balancePaise: number;
  lowBalancePaise: number;
  floorPaise: number;
  low: boolean;
}

export async function walletFor(organizationId: string): Promise<WalletState> {
  const wallet = await db.utilityWallet.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
    select: { balancePaise: true, lowBalancePaise: true, floorPaise: true },
  });

  return {
    ...wallet,
    low: wallet.lowBalancePaise > 0 && wallet.balancePaise <= wallet.lowBalancePaise,
  };
}

/**
 * Can this send go ahead.
 *
 * Checked before the provider is called, never after, because a message that is
 * already gone cannot be refused. A free message is always allowed: refusing to
 * send an email that costs nothing because a WhatsApp budget ran out would be
 * absurd.
 */
export async function canSpend(organizationId: string, costPaise: number): Promise<boolean> {
  if (costPaise <= 0) return true;
  const wallet = await walletFor(organizationId);
  return wallet.balancePaise - costPaise >= wallet.floorPaise;
}

export async function spend(input: {
  organizationId: string;
  paise: number;
  reason: string;
  channel?: string;
  logId?: string;
  note?: string;
}): Promise<void> {
  if (input.paise === 0 && input.reason !== 'EMAIL') return;

  const wallet = await db.utilityWallet.upsert({
    where: { organizationId: input.organizationId },
    update: {},
    create: { organizationId: input.organizationId },
    select: { id: true },
  });

  // One transaction, so a ledger row without the matching balance change cannot
  // exist. This is money, even if it is only paise at a time.
  await db.$transaction([
    db.utilityTransaction.create({
      data: {
        walletId: wallet.id,
        paise: -Math.abs(input.paise),
        reason: input.reason,
        channel: input.channel ?? null,
        logId: input.logId ?? null,
        note: input.note ?? null,
      },
    }),
    db.utilityWallet.update({
      where: { id: wallet.id },
      data: { balancePaise: { decrement: Math.abs(input.paise) } },
    }),
  ]);
}

export async function topUp(input: {
  organizationId: string;
  paise: number;
  note?: string;
  createdById?: string;
}): Promise<void> {
  const wallet = await db.utilityWallet.upsert({
    where: { organizationId: input.organizationId },
    update: {},
    create: { organizationId: input.organizationId },
    select: { id: true },
  });

  await db.$transaction([
    db.utilityTransaction.create({
      data: {
        walletId: wallet.id,
        paise: Math.abs(input.paise),
        reason: 'TOPUP',
        note: input.note ?? null,
        createdById: input.createdById ?? null,
      },
    }),
    db.utilityWallet.update({
      where: { id: wallet.id },
      data: { balancePaise: { increment: Math.abs(input.paise) } },
    }),
  ]);
}

/** A refund of an estimate, for a send that was charged and then failed. */
export async function refund(input: {
  organizationId: string;
  paise: number;
  logId?: string;
  note?: string;
}): Promise<void> {
  if (input.paise <= 0) return;
  await topUp({
    organizationId: input.organizationId,
    paise: input.paise,
    note: input.note ?? `Refund for a failed send${input.logId ? ` (${input.logId})` : ''}`,
  });
}

export async function spentSince(organizationId: string, since: Date): Promise<number> {
  const wallet = await db.utilityWallet.findUnique({
    where: { organizationId },
    select: { id: true },
  });
  if (!wallet) return 0;

  const result = await db.utilityTransaction.aggregate({
    where: { walletId: wallet.id, createdAt: { gte: since }, paise: { lt: 0 } },
    _sum: { paise: true },
  });
  return Math.abs(result._sum.paise ?? 0);
}
