'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { seal, open as unseal } from '@/lib/secrets';
import { hashPassword, verifyPassword } from '@/lib/password';
import {
  generateSecret,
  verifyCode,
  otpauthUri,
  generateRecoveryCodes,
} from '@/lib/totp';
import { recordAudit } from '@/lib/audit';
import type { ActionState } from '@/server/courses';

/**
 * Turning two factor on, and off.
 *
 * The secret is generated here, shown once, and only committed when the person
 * proves they typed it into their app correctly. Committing first is how an
 * admin ends up locked out of their own product by a typo, and there is no
 * safe support answer to that.
 *
 * Recovery codes are generated at the same moment and shown once. They are
 * stored as scrypt hashes like passwords, because a recovery code is a password
 * that happens to be shorter.
 */

async function me() {
  const [tenant, user] = await Promise.all([requireTenant(), getSessionUser()]);
  if (!user) throw new Error('UNAUTHORIZED');
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return user;
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[two-factor]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export interface SetupState extends ActionState {
  secret?: string;
  uri?: string;
  recoveryCodes?: string[];
}

/**
 * Step one: propose a secret.
 *
 * Sealed into the row immediately but with `twoFactorEnabledAt` left null, so
 * it is a proposal rather than a setting: nothing checks it at sign-in until
 * the confirm step, and asking again simply replaces it.
 */
export async function beginTwoFactor(): Promise<SetupState> {
  try {
    const user = await me();

    const existing = await db.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabledAt: true },
    });
    if (existing?.twoFactorEnabledAt) {
      return { error: 'Two factor is already on for this account.' };
    }

    const organization = await db.organization.findUnique({
      where: { id: user.organizationId },
      select: { name: true },
    });

    const secret = generateSecret();

    await db.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: seal(secret), twoFactorEnabledAt: null },
    });

    return {
      ok: true,
      secret,
      uri: otpauthUri({
        secret,
        account: user.email ?? user.name,
        issuer: organization?.name ?? 'Academy',
      }),
    };
  } catch (err) {
    return fail(err);
  }
}

/** Step two: prove the app has it, and only then switch it on. */
export async function confirmTwoFactor(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  try {
    const user = await me();
    const code = String(formData.get('code') ?? '').trim();
    if (!code) return { error: 'Enter the six digit code from your app.' };

    const row = await db.user.findUnique({
      where: { id: user.id },
      select: { twoFactorSecret: true, twoFactorEnabledAt: true },
    });
    if (row?.twoFactorEnabledAt) return { error: 'Two factor is already on.' };

    const secret = row?.twoFactorSecret ? unseal(row.twoFactorSecret) : null;
    if (!secret) return { error: 'Start the setup again.' };

    if (!verifyCode(secret, code)) {
      return {
        error:
          'That code did not match. Check the time on your phone is correct, then try the next code.',
      };
    }

    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(
      recoveryCodes.map((value) => hashPassword(value.replace(/\s/g, '').toLowerCase())),
    );

    await db.user.update({
      where: { id: user.id },
      data: { twoFactorEnabledAt: new Date(), twoFactorRecoveryCodes: hashes },
    });

    await recordAudit({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'account.two_factor_enabled',
      entity: 'User',
      entityId: user.id,
    });

    revalidatePath('/account/security');

    return {
      ok: true,
      message: 'Two factor is on. Save these recovery codes somewhere safe; they are shown once.',
      recoveryCodes,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Turning it off needs the password.
 *
 * Otherwise anyone who reaches an unlocked laptop can remove the second factor
 * in two clicks, which makes having it close to pointless.
 */
export async function disableTwoFactor(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await me();
    const password = String(formData.get('password') ?? '');
    if (!password) return { error: 'Enter your password to switch this off.' };

    const row = await db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!row?.passwordHash || !(await verifyPassword(password, row.passwordHash))) {
      return { error: 'That password does not match.' };
    }

    await db.user.update({
      where: { id: user.id },
      data: { twoFactorEnabledAt: null, twoFactorSecret: null, twoFactorRecoveryCodes: [] },
    });

    await recordAudit({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'account.two_factor_disabled',
      entity: 'User',
      entityId: user.id,
    });

    revalidatePath('/account/security');
    return { ok: true, message: 'Two factor is off.' };
  } catch (err) {
    return fail(err);
  }
}

/** Fresh codes, when the old list is spent or was written on a lost notebook. */
export async function regenerateRecoveryCodes(): Promise<SetupState> {
  try {
    const user = await me();

    const row = await db.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabledAt: true },
    });
    if (!row?.twoFactorEnabledAt) return { error: 'Two factor is not on for this account.' };

    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(
      recoveryCodes.map((value) => hashPassword(value.replace(/\s/g, '').toLowerCase())),
    );

    await db.user.update({
      where: { id: user.id },
      data: { twoFactorRecoveryCodes: hashes },
    });

    revalidatePath('/account/security');
    return {
      ok: true,
      message: 'New codes. The old ones no longer work.',
      recoveryCodes,
    };
  } catch (err) {
    return fail(err);
  }
}
