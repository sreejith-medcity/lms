'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { toPaise } from '@/lib/money';
import type { ActionState } from '@/server/courses';

/**
 * Settlements: what the gateway actually paid into the bank.
 *
 * Collections and settlements are different numbers and an institute that
 * treats them as one cannot answer why the bank is short. A settlement is the
 * gateway's own payout — gross, its fee, GST on that fee, net — and the
 * payments it covers are attached to it, so every rupee collected is either
 * settled, or visibly not settled yet.
 *
 * Entered by hand for now. Razorpay's settlement API is a Phase 7 connection;
 * the shape here is the one it returns, so wiring it up later is a fetch and a
 * loop rather than a rewrite.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('sales.settlements', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[settlements]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const settlementShape = z.object({
  gateway: z.string().trim().min(2).max(40),
  gatewayRef: z.string().trim().min(2, 'The settlement id from the gateway').max(80),
  grossRupees: z.coerce.number().min(0),
  feeRupees: z.coerce.number().min(0),
  taxRupees: z.coerce.number().min(0),
  settledAt: z.string().min(1, 'When did it land?'),
  /** Payments up to this date get attached, oldest first, until the gross runs out. */
  coverUntil: z.string().optional(),
});

export async function recordSettlement(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const parsed = settlementShape.safeParse({
      gateway: formData.get('gateway') || 'RAZORPAY',
      gatewayRef: formData.get('gatewayRef'),
      grossRupees: formData.get('grossRupees'),
      feeRupees: formData.get('feeRupees') || 0,
      taxRupees: formData.get('taxRupees') || 0,
      settledAt: formData.get('settledAt'),
      coverUntil: formData.get('coverUntil') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const grossPaise = toPaise(d.grossRupees);
    const feePaise = toPaise(d.feeRupees);
    const taxPaise = toPaise(d.taxRupees);
    const netPaise = grossPaise - feePaise - taxPaise;

    if (grossPaise <= 0) return { error: 'A settlement of nothing is not a settlement.' };
    if (netPaise < 0) return { error: 'The fee and tax are more than the gross.' };

    // Scoped, or two academies settling through the same gateway would each be
    // told the other's reference had already been entered: a false refusal, and
    // a small leak of the fact that somebody else used that reference.
    const existing = await db.settlement.findFirst({
      where: {
        organizationId: tenant.organizationId,
        gateway: d.gateway,
        gatewayRef: d.gatewayRef,
      },
      select: { id: true },
    });
    if (existing) return { error: `${d.gatewayRef} has already been entered.` };

    const settledAt = new Date(d.settledAt);

    const settlement = await db.settlement.create({
      data: {
        organizationId: tenant.organizationId,
        gateway: d.gateway,
        gatewayRef: d.gatewayRef,
        grossPaise,
        feePaise,
        taxPaise,
        netPaise,
        settledAt,
      },
      select: { id: true },
    });

    // Attach captured payments oldest first until the gross is used up. The
    // gateway settles in the order it captured, so this matches in practice and
    // is visible when it does not: anything left over stays unsettled on screen.
    const cutoff = d.coverUntil ? new Date(`${d.coverUntil}T23:59:59`) : settledAt;
    const candidates = await db.payment.findMany({
      where: {
        organizationId: tenant.organizationId,
        gateway: d.gateway,
        status: 'CAPTURED',
        settlementId: null,
        capturedAt: { lte: cutoff },
      },
      orderBy: { capturedAt: 'asc' },
      select: { id: true, amountPaise: true },
    });

    const covered: string[] = [];
    let running = 0;
    for (const payment of candidates) {
      if (running + payment.amountPaise > grossPaise) break;
      running += payment.amountPaise;
      covered.push(payment.id);
    }

    if (covered.length) {
      await db.payment.updateMany({
        where: { id: { in: covered } },
        data: { settlementId: settlement.id },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'settlement.recorded',
      entity: 'Settlement',
      entityId: settlement.id,
      after: { gatewayRef: d.gatewayRef, grossPaise, netPaise, payments: covered.length },
    });

    revalidatePath('/admin/settlements');
    revalidatePath('/admin/payments');

    const shortfall = grossPaise - running;
    return {
      ok: true,
      message:
        covered.length === 0
          ? 'Recorded, but no captured payments matched it. Check the gateway and the date.'
          : shortfall > 0
            ? `Recorded against ${covered.length} payments. ${(shortfall / 100).toFixed(2)} of the gross is not accounted for by any single payment.`
            : `Recorded against ${covered.length} payments, fully accounted for.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteSettlement(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');

    const settlement = await db.settlement.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!settlement) return { error: 'Settlement not found.' };

    // The payments go back to unsettled rather than disappearing with it.
    await db.$transaction([
      db.payment.updateMany({ where: { settlementId: id }, data: { settlementId: null } }),
      db.settlement.delete({ where: { id } }),
    ]);

    revalidatePath('/admin/settlements');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
