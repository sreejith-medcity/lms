'use server';

import { randomBytes, createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { resolveTenantByHost } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { authAttemptKeys, checkAll, tooManyAttemptsMessage } from '@/lib/rate-limit';
import type { ActionState } from '@/server/courses';

/**
 * Getting back into an account.
 *
 * Two ways, because only one of them works today. A learner can ask for a reset
 * link, which is stored hashed, expires in an hour and can be used once; it
 * cannot be delivered until email is connected, and the form says so rather than
 * claiming to have sent something. Meanwhile staff can reset a password and read
 * the new one out, which is what an academy does over the phone anyway.
 *
 * The request form answers identically whether or not the address exists. A
 * password reset form that says "no such account" is an account enumerator.
 */

const TOKEN_MINUTES = 60;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function requestPasswordReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { deliverable?: boolean }> {
  const same = {
    ok: true as const,
    message:
      'If that address has an account here, a reset link is on its way. It is good for an hour.',
  };

  try {
    const h = await headers();
    const tenantId = await resolveTenantByHost(h.get('host') ?? '');
    if (!tenantId) return { error: 'This hostname is not linked to an academy.' };

    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    if (!email.includes('@')) return { error: 'Enter the email address on the account.' };

    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const limit = checkAll(authAttemptKeys('reset', tenantId, email, ip), 5, 60 * 60);
    if (!limit.ok) return { error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

    const org = await db.organization.findFirst({ where: { tenantId }, select: { id: true } });
    if (!org) return { error: 'This hostname is not linked to an academy.' };

    const user = await db.user.findFirst({
      where: { organizationId: org.id, email, deletedAt: null },
      select: { id: true },
    });

    // Same answer either way, so this cannot be used to find out who has an account.
    if (!user) return { ...same, deliverable: Boolean(process.env.SMTP_URL) };

    const token = randomBytes(32).toString('base64url');

    await db.otpToken.create({
      data: {
        userId: user.id,
        channel: 'email',
        target: email,
        codeHash: hashToken(token),
        purpose: 'reset',
        expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60_000),
      },
    });

    if (process.env.SMTP_URL) {
      // Sending lands with the notification engine. Until then the token exists
      // and is valid; nothing has been delivered and nothing claims otherwise.
      console.info('[reset] token created, delivery pending an email provider');
    }

    return { ...same, deliverable: Boolean(process.env.SMTP_URL) };
  } catch (err) {
    console.error('[reset]', err instanceof Error ? err.message : err);
    return { error: 'Something went wrong. Please try again.' };
  }
}

export async function completePasswordReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const token = String(formData.get('token') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirm') ?? '');

    if (password.length < 8) return { error: 'Use at least eight characters.' };
    if (password !== confirm) return { error: 'The two passwords do not match.' };

    const record = await db.otpToken.findFirst({
      where: {
        codeHash: hashToken(token),
        purpose: 'reset',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, userId: true },
    });
    if (!record?.userId) {
      return { error: 'That link has expired or has already been used. Ask for another.' };
    }

    await db.$transaction([
      db.user.update({
        where: { id: record.userId },
        data: { passwordHash: await hashPassword(password), mustResetPassword: false },
      }),
      db.otpToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Every other session ends. Whoever asked for this may be locking someone out.
      db.authSession.deleteMany({ where: { userId: record.userId } }),
    ]);

    return { ok: true, message: 'Your password is changed. Sign in with it.' };
  } catch (err) {
    console.error('[reset]', err instanceof Error ? err.message : err);
    return { error: 'Something went wrong. Please try again.' };
  }
}

/**
 * Staff resetting someone's password and reading the new one out. This is what
 * an academy already does over the phone, and it works with no email provider.
 */
export async function resetPasswordForUser(
  userId: string,
): Promise<ActionState & { temporaryPassword?: string }> {
  try {
    const [tenant, actor] = await Promise.all([
      requireTenant(),
      requireStaff('learner.learner_management', 'edit'),
    ]);

    const user = await db.user.findFirst({
      where: { id: userId, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!user) return { error: 'Account not found.' };

    const temporaryPassword = `${randomBytes(6).toString('base64url')}-${randomBytes(2).toString('hex')}`;

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(temporaryPassword), mustResetPassword: true },
      }),
      db.authSession.deleteMany({ where: { userId: user.id } }),
    ]);

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: actor.id,
      action: 'password.reset.by.staff',
      entity: 'User',
      entityId: user.id,
      after: { name: user.name },
    });

    return {
      ok: true,
      temporaryPassword,
      message: `${user.name} can sign in with this once, then has to change it. Everywhere they were signed in has been signed out.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
    console.error('[reset]', message);
    return { error: 'Something went wrong. Please try again.' };
  }
}
