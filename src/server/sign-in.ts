'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { checkOtp } from '@/lib/otp';
import { sendOtp } from '@/lib/otp-delivery';
import { verifyCode } from '@/lib/totp';
import { open as unseal } from '@/lib/secrets';
import { authAttemptKeys, checkAll, resetAll, tooManyAttemptsMessage } from '@/lib/rate-limit';
import {
  organisationForHost,
  completeSignIn,
  issueSession,
  pendingUserId,
  clearPending,
  landingFor,
} from '@/lib/sign-in';

/**
 * Signing in without a password, and the second factor.
 *
 * A code to a phone is the door most learners here will actually use: an
 * institute whose students are on WhatsApp and shared family email accounts
 * gets more support calls about forgotten passwords than about anything else.
 *
 * Two rules run through all of it. Nothing here reveals whether an account
 * exists, so the same reply comes back for a number with an account and one
 * without. And a code that arrives is always a code somebody asked for on this
 * device: the rate limits are per number and per address, not per session.
 */

export interface CodeState {
  error?: string;
  sent?: boolean;
  sentTo?: string;
  /** Echoed back so the second step knows who to check the code against. */
  target?: string;
}

function normalise(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value.includes('@')) return value;
  const digits = value.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export async function requestCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const target = normalise(String(formData.get('identifier') ?? ''));

  if (!target || (!target.includes('@') && target.length !== 10)) {
    return { error: 'Enter your mobile number or your email address.' };
  }

  const org = await organisationForHost();
  if (!org) return { error: 'This hostname is not linked to an academy.' };

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  // Tighter than the password form, because every one of these costs the
  // academy money to send.
  const keys = authAttemptKeys('otp', org.tenantId, target, ip);
  const limit = checkAll(keys, 4, 15 * 60);
  if (!limit.ok) return { error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

  const user = await db.user.findFirst({
    where: {
      organizationId: org.organizationId,
      deletedAt: null,
      OR: [{ email: target }, { phone: target }],
    },
    select: { id: true },
  });

  // No account is not an error the caller gets to see. Saying "no such number"
  // turns this form into a way to find out who studies here.
  if (!user) {
    return {
      sent: true,
      target,
      sentTo: target.includes('@') ? 'that address' : 'that number',
    };
  }

  const result = await sendOtp({
    organizationId: org.organizationId,
    target,
    purpose: 'login',
    userId: user.id,
  });

  if (!result.ok) return { error: result.error ?? 'Could not send a code just now.' };

  return { sent: true, target, sentTo: result.sentTo };
}

export async function signInWithCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const target = normalise(String(formData.get('target') ?? ''));
  const code = String(formData.get('code') ?? '').trim();

  if (!target || !code) return { error: 'Enter the code that was sent to you.', sent: true, target };

  const org = await organisationForHost();
  if (!org) return { error: 'This hostname is not linked to an academy.' };

  const checked = await checkOtp({ target, purpose: 'login', code });
  if (!checked.ok || !checked.userId) {
    return { error: checked.error ?? 'That code is wrong or has expired.', sent: true, target };
  }

  const user = await db.user.findFirst({
    where: { id: checked.userId, organizationId: org.organizationId, deletedAt: null },
    select: { id: true, phone: true, email: true, phoneVerifiedAt: true, emailVerifiedAt: true },
  });
  if (!user) return { error: 'That code is wrong or has expired.', sent: true, target };

  // Using a code proves the address works, which is worth recording: it is the
  // same proof a separate verification email would have given.
  const isEmail = target.includes('@');
  if (isEmail && !user.emailVerifiedAt) {
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
  if (!isEmail && !user.phoneVerifiedAt) {
    await db.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
  }

  const outcome = await completeSignIn(user.id);
  if (outcome.status === 'blocked') return { error: outcome.message, sent: true, target };
  if (outcome.status === 'second-factor') redirect('/login/verify');
  redirect(outcome.redirectTo);
}

export interface VerifyState {
  error?: string;
}

/**
 * The second factor.
 *
 * Reached only with the pending cookie, which is not a session and which
 * nothing else in the product accepts. A recovery code is taken here too, and
 * is spent when it is used, because a recovery code that still works after it
 * has been used is just a shorter password.
 */
export async function verifySecondFactor(
  _prev: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const userId = await pendingUserId();
  if (!userId) return { error: 'That took too long. Start again.' };

  const supplied = String(formData.get('code') ?? '').trim();
  if (!supplied) return { error: 'Enter the code from your authenticator app.' };

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const keys = authAttemptKeys('2fa', userId, userId, ip);
  const limit = checkAll(keys, 6, 15 * 60);
  if (!limit.ok) return { error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, twoFactorSecret: true, twoFactorRecoveryCodes: true },
  });
  if (!user?.twoFactorSecret) return { error: 'Start again.' };

  const secret = unseal(user.twoFactorSecret);
  if (!secret) return { error: 'Two factor is misconfigured on this account. Contact your academy.' };

  if (verifyCode(secret, supplied)) {
    resetAll(keys);
    await clearPending();
    await issueSession(user.id);
    redirect(await landingFor(user.id));
  }

  // Recovery codes are stored hashed, the same as everything else that unlocks
  // an account, so each one has to be checked rather than looked up.
  const match = await findRecoveryCode(user.twoFactorRecoveryCodes, supplied);
  if (match !== null) {
    resetAll(keys);
    await db.user.update({
      where: { id: user.id },
      data: {
        twoFactorRecoveryCodes: user.twoFactorRecoveryCodes.filter((_, i) => i !== match),
      },
    });
    await clearPending();
    await issueSession(user.id);
    redirect(await landingFor(user.id));
  }

  return { error: 'That code is wrong. Check the app, or use one of your recovery codes.' };
}

/** Recovery codes are held as scrypt hashes; this finds which one was used. */
async function findRecoveryCode(stored: string[], supplied: string): Promise<number | null> {
  const { verifyPassword } = await import('@/lib/password');
  const cleaned = supplied.replace(/\s/g, '').toLowerCase();

  for (let i = 0; i < stored.length; i += 1) {
    if (await verifyPassword(cleaned, stored[i])) return i;
  }
  return null;
}
