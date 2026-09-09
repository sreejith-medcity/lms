'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import { resolveTenantByHost } from '@/lib/tenant';
import { authAttemptKeys, checkAll, resetAll, tooManyAttemptsMessage } from '@/lib/rate-limit';
import { completeSignIn } from '@/lib/sign-in';

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const identifier = String(formData.get('identifier') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!identifier || !password) return { error: 'Enter your email and password.' };

  const h = await headers();
  const tenantId = await resolveTenantByHost(h.get('host') ?? '');
  if (!tenantId) return { error: 'This hostname is not linked to an academy.' };

  const org = await db.organization.findFirst({ where: { tenantId }, select: { id: true } });
  if (!org) return { error: 'This hostname is not linked to an academy.' };

  // Five attempts per fifteen minutes, counted against both the caller's
  // address and the identifier being tried, so neither a scripted sweep nor a
  // distributed run at one account gets far.
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const keys = authAttemptKeys('login', tenantId, identifier, ip);
  const limit = checkAll(keys, 5, 15 * 60);
  if (!limit.ok) return { error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

  const user = await db.user.findFirst({
    where: {
      organizationId: org.id,
      deletedAt: null,
      OR: [{ email: identifier }, { phone: identifier }],
    },
  });

  // Same message either way, so the form cannot be used to discover who has an account.
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return { error: 'Those details do not match an account.' };
  }

  // Correct credentials clear the buckets, so a legitimate user who mistyped a
  // few times is not left one attempt away from a lockout.
  resetAll(keys);

  // Everything past this point is shared with the code and single sign-on
  // doors, including the second factor. Keeping it in one place is what stops
  // two factor being enforced here and quietly skipped there.
  const outcome = await completeSignIn(user.id);

  if (outcome.status === 'blocked') return { error: outcome.message };
  if (outcome.status === 'second-factor') redirect('/login/verify');

  redirect(outcome.redirectTo);
}
