'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff, getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { credit, loyaltyConfig, makeReferralCode } from '@/lib/wallet';
import type { ActionState } from '@/server/courses';

/**
 * The wallet, from the outside.
 *
 * Two audiences: staff setting the rules and adjusting a balance by hand, and a
 * learner looking at their own. A learner can never move points; the only thing
 * they can do here is take their referral code and give it away.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('settings.preferences', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[wallet]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const configShape = z.object({
  enabled: z.boolean(),
  maxCreditAllowed: z.coerce.number().int().min(0).max(1_000_000),
  maxRedeemablePercent: z.coerce.number().min(0).max(100),
  pointToCurrencyPaise: z.coerce.number().int().min(1).max(100_000),
  normalSignupCredit: z.coerce.number().int().min(0).max(1_000_000),
  referralSignupCredit: z.coerce.number().int().min(0).max(1_000_000),
  referrerCredit: z.coerce.number().int().min(0).max(1_000_000),
  referralPurchaseCredit: z.coerce.number().int().min(0).max(1_000_000),
});

export async function saveLoyaltyConfig(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const parsed = configShape.safeParse({
      enabled: formData.get('enabled') === 'on',
      maxCreditAllowed: formData.get('maxCreditAllowed'),
      maxRedeemablePercent: formData.get('maxRedeemablePercent'),
      pointToCurrencyPaise: formData.get('pointToCurrencyPaise'),
      normalSignupCredit: formData.get('normalSignupCredit'),
      referralSignupCredit: formData.get('referralSignupCredit'),
      referrerCredit: formData.get('referrerCredit'),
      referralPurchaseCredit: formData.get('referralPurchaseCredit'),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    if (d.enabled && d.maxRedeemablePercent >= 100) {
      return {
        error:
          'Letting points cover the whole order means a course can be had for nothing. Keep the ceiling below 100%.',
      };
    }

    await db.loyaltyConfig.upsert({
      where: { organizationId: tenant.organizationId },
      create: { organizationId: tenant.organizationId, ...d },
      update: d,
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'loyalty.configured',
      entity: 'LoyaltyConfig',
      entityId: tenant.organizationId,
      after: { enabled: d.enabled, maxRedeemablePercent: d.maxRedeemablePercent },
    });

    revalidatePath('/admin/loyalty');
    return { ok: true, message: d.enabled ? 'Points are on.' : 'Points are off.' };
  } catch (err) {
    return fail(err);
  }
}

/** A hand adjustment, which always needs a reason on the record. */
export async function adjustWallet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const userId = String(formData.get('userId') ?? '');
    const points = Math.round(Number(formData.get('points') ?? 0));
    const note = String(formData.get('note') ?? '').trim();

    if (!userId) return { error: 'Pick a learner.' };
    if (!Number.isFinite(points) || points === 0) return { error: 'How many points?' };
    if (note.length < 3) return { error: 'Say why. A balance that changed for no stated reason is a support ticket later.' };

    const learner = await db.user.findFirst({
      where: { id: userId, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!learner) return { error: 'Learner not found.' };

    const config = await loyaltyConfig(tenant.organizationId);

    const result = await credit({
      userId: learner.id,
      points,
      reason: 'ADMIN',
      note,
      createdById: user.id,
      maxBalance: config.maxCreditAllowed,
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'wallet.adjusted',
      entity: 'User',
      entityId: learner.id,
      after: { points: result.applied, balance: result.balance, note },
    });

    revalidatePath('/admin/loyalty');

    if (result.applied === 0) {
      return { error: 'Nothing moved: that would take them past the ceiling, or below zero.' };
    }
    return {
      ok: true,
      message: `${result.applied > 0 ? 'Added' : 'Removed'} ${Math.abs(result.applied)} points. ${learner.name} now has ${result.balance}.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The learner's own code, made on first ask.
 *
 * Not created at signup, because most people never share one and a table of
 * unused codes is a table nobody reads.
 */
export async function myReferralCode(): Promise<ActionState & { code?: string }> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };

    const existing = await db.referralCode.findUnique({
      where: { userId: user.id },
      select: { code: true },
    });
    if (existing) return { ok: true, code: existing.code };

    const config = await loyaltyConfig(tenant.organizationId);
    if (!config.enabled) return { error: 'Referrals are not switched on.' };

    // Collisions are unlikely and cheap to retry; the code is short on purpose,
    // because it gets read out over the phone.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeReferralCode(user.name);
      const clash = await db.referralCode.findUnique({ where: { code }, select: { id: true } });
      if (clash) continue;

      await db.referralCode.create({ data: { userId: user.id, code } });
      return { ok: true, code };
    }

    return { error: 'Could not make a code just now. Please try again.' };
  } catch (err) {
    return fail(err);
  }
}
