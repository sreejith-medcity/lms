'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { drain } from '@/lib/messaging/drain';
import { topUp } from '@/lib/messaging/wallet';
import type { ActionState } from '@/server/courses';

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('settings.integrations', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[messaging]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/**
 * Send what is waiting, now, rather than at the next scheduled run.
 *
 * Here because the first question anybody asks after connecting a provider is
 * "did it work", and the honest answer needs a send. Same code path as the cron,
 * same claiming, so pressing it twice sends nothing twice.
 */
export async function sendNow(): Promise<ActionState> {
  try {
    const { tenant } = await guard();
    const result = await drain(tenant.organizationId, 50);

    revalidatePath('/admin/settings/messaging');

    if (result.sent === 0 && result.failed === 0 && result.deferred === 0) {
      return { ok: true, message: 'Nothing was waiting.' };
    }

    const parts: string[] = [];
    if (result.sent) parts.push(`${result.sent} sent`);
    if (result.failed) parts.push(`${result.failed} refused`);
    if (result.deferred) parts.push(`${result.deferred} still waiting`);

    return {
      ok: true,
      message: `${parts.join(', ')}.${result.blocked.length ? ` ${result.blocked.join(' ')}` : ''}`,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Adding credit.
 *
 * Recorded rather than set. An academy that can type a new balance into a box
 * has no way to answer where the money went, so the balance is only ever the sum
 * of its ledger.
 */
export async function addCredit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const rupees = Number(String(formData.get('rupees') ?? '').trim());
    if (!Number.isFinite(rupees) || rupees <= 0) {
      return { error: 'Enter how much was added, in rupees.' };
    }
    if (rupees > 1_000_000) return { error: 'That is more than ten lakh. Check the figure.' };

    const note = String(formData.get('note') ?? '').trim();

    await topUp({
      organizationId: tenant.organizationId,
      paise: Math.round(rupees * 100),
      note: note || 'Added by hand',
      createdById: user.id,
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'utility.topup',
      entity: 'UtilityWallet',
      after: { paise: Math.round(rupees * 100), note },
    });

    revalidatePath('/admin/settings/messaging');
    return { ok: true, message: `Added INR ${rupees.toFixed(2)}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function setWalletThresholds(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const low = Math.max(0, Math.round(Number(formData.get('lowRupees') ?? 0) * 100));
    const floor = Math.max(0, Math.round(Number(formData.get('floorRupees') ?? 0) * 100));

    await db.utilityWallet.upsert({
      where: { organizationId: tenant.organizationId },
      update: { lowBalancePaise: low, floorPaise: floor },
      create: { organizationId: tenant.organizationId, lowBalancePaise: low, floorPaise: floor },
    });

    revalidatePath('/admin/settings/messaging');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

/** Give up on a message that will never send, so the failed count means something. */
export async function cancelQueued(logId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');

    const updated = await db.notificationLog.updateMany({
      where: {
        id: logId,
        organizationId: tenant.organizationId,
        status: { in: ['QUEUED', 'FAILED'] },
      },
      data: { status: 'CANCELLED', nextAttemptAt: null },
    });

    if (updated.count === 0) return { error: 'That one has already gone or is being sent.' };

    revalidatePath('/admin/settings/messaging');
    return { ok: true, message: 'Cancelled.' };
  } catch (err) {
    return fail(err);
  }
}

/** Put a failed message back in the queue, after the reason for it was fixed. */
export async function retryFailed(): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const updated = await db.notificationLog.updateMany({
      where: { organizationId: tenant.organizationId, status: 'FAILED' },
      data: { status: 'QUEUED', attempts: 0, nextAttemptAt: new Date(), error: null },
    });

    revalidatePath('/admin/settings/messaging');
    return {
      ok: true,
      message: updated.count
        ? `${updated.count} put back in the queue.`
        : 'Nothing had failed.',
    };
  } catch (err) {
    return fail(err);
  }
}
