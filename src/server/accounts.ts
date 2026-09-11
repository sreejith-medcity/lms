'use server';

import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { reportConversion } from '@/lib/analytics-server';
import { conversionHints, requestAttribution } from '@/lib/attribution-server';
import { SESSION_COOKIE } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { resolveTenantByHost } from '@/lib/tenant';
import { authAttemptKeys, checkAll, tooManyAttemptsMessage } from '@/lib/rate-limit';
import type { ActionState } from '@/server/courses';
import { creditOnSignup } from '@/lib/wallet';
import { settingBool, settingText } from '@/lib/settings/store';
import { saveFieldValues, signupFields } from '@/lib/custom-fields';

const SESSION_DAYS = 30;

/**
 * The sign-up shape depends on what the academy asks for.
 *
 * An institute with a walk-in intake has mobile numbers and no email addresses;
 * one selling online has the reverse. Forcing either is how a sign-up form
 * loses people at the first field.
 */
function signupShape(primary: string) {
  const email =
    primary === 'PHONE'
      ? z.string().trim().toLowerCase().email('Enter a valid email address').optional().or(z.literal(''))
      : z.string().trim().toLowerCase().email('Enter a valid email address');

  const phone =
    primary === 'EMAIL'
      ? z.string().trim().max(20).optional()
      : z.string().trim().min(6, 'Enter your mobile number').max(20);

  return z.object({
    name: z.string().trim().min(2, 'Please enter your name').max(80),
    email,
    phone,
    password: z.string().min(8, 'Use at least 8 characters').max(200),
  });
}

export async function register(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const h = await headers();
    const tenantId = await resolveTenantByHost(h.get('host') ?? '');
    if (!tenantId) return { error: 'This hostname is not linked to an academy.' };

    const org = await db.organization.findFirst({ where: { tenantId }, select: { id: true } });
    if (!org) return { error: 'This hostname is not linked to an academy.' };

    const [primary, selfSignup] = await Promise.all([
      settingText(org.id, 'auth.primaryField'),
      settingBool(org.id, 'auth.selfSignup'),
    ]);

    if (!selfSignup) {
      return { error: 'This academy enrols people directly. Please contact them to get an account.' };
    }

    const parsed = signupShape(primary).safeParse({
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone') || undefined,
      password: formData.get('password'),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const { name, email, phone, password } = parsed.data;

    // Sign-up is cheap to script and creates rows, so it is limited harder than
    // sign-in: three accounts per address per hour.
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const limit = checkAll(authAttemptKeys('signup', tenantId, email || phone || '', ip), 3, 60 * 60);
    if (!limit.ok) return { error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

    // Whichever field the academy made primary is the one that has to be unique,
    // because that is the one people will sign in with.
    const existing = await db.user.findFirst({
      where: {
        organizationId: org.id,
        deletedAt: null,
        ...(primary === 'PHONE' ? { phone } : { email }),
      },
      select: { id: true },
    });
    if (existing) {
      return {
        error:
          primary === 'PHONE'
            ? 'An account with that mobile number already exists. Try signing in.'
            : 'An account with that email already exists. Try signing in.',
      };
    }

    // Registration numbers continue the institute's own sequence rather than
    // restarting, so they stay meaningful after a migration.
    const last = await db.user.findFirst({
      where: { organizationId: org.id, registrationNo: { not: null } },
      orderBy: { registrationNo: 'desc' },
      select: { registrationNo: true },
    });

    const user = await db.user.create({
      data: {
        organizationId: org.id,
        name,
        email: email || null,
        phone: phone || null,
        passwordHash: await hashPassword(password),
        kind: 'LEARNER',
        status: 'REGISTERED',
        registrationNo: (last?.registrationNo ?? 0) + 1,
        learnerProfile: { create: {} },
      },
      select: { id: true },
    });

    // Whatever the academy added to the form, stored against the new account.
    const extra = await signupFields(org.id, 'BEFORE');
    if (extra.length > 0) {
      await saveFieldValues({
        organizationId: org.id,
        entity: 'LEARNER',
        entityId: user.id,
        userId: user.id,
        values: Object.fromEntries(
          extra.map((f) => [f.key, String(formData.get(`cf_${f.key}`) ?? '')]),
        ),
      });
    }

    await creditOnSignup({
      organizationId: org.id,
      userId: user.id,
      userName: name,
      referralCode: String(formData.get('referralCode') ?? '') || null,
    });

    await startSession(user.id, h.get('user-agent'), h.get('x-forwarded-for'));

    reportConversion({
      organizationId: org.id,
      event: 'sign_up',
      eventId: `signup:${user.id}`,
      email: email || null,
      phone: phone || null,
      ...conversionHints(await requestAttribution()),
    }).catch(() => undefined);
  } catch (err) {
    console.error('[accounts]', err instanceof Error ? err.message : err);
    return { error: 'Could not create the account. Please try again.' };
  }

  // The flag lets the learner home page raise the browser-side sign-up
  // event once, with the same id the server just sent.
  redirect('/learn?welcome=1');
}

async function startSession(userId: string, userAgent: string | null, forwardedFor: string | null) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);

  await db.authSession.create({
    data: {
      userId,
      sessionToken: token,
      expiresAt,
      ip: forwardedFor?.split(',')[0]?.trim(),
      userAgent: userAgent ?? undefined,
    },
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}
