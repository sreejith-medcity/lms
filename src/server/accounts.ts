'use server';

import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { takeNextPath } from '@/lib/next-path';
import { z } from 'zod';
import { db } from '@/lib/db';
import { CAPTCHA_REFUSED, verifyCaptcha } from '@/lib/captcha';
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
import { happened, notifyLearner } from '@/lib/events';
import { signupPhone } from '@/lib/phone';
import { sendOtp } from '@/lib/otp-delivery';

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

    const org = await db.organization.findFirst({ where: { tenantId }, select: { id: true, name: true } });
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

    const { name, email, password } = parsed.data;
    // A mobile is kept the one way the rest of the product reads it: ten
    // digits for India, dial code and digits otherwise. Anything else on the
    // form is a typo, and a typo here means the reminders go nowhere.
    let phone = parsed.data.phone?.trim() || '';
    if (phone) {
      const normalised = signupPhone(phone);
      if (!normalised) return { error: 'Enter a mobile number as ten digits, or with its country code (+971...).' };
      phone = normalised;
    }

    // Sign-up is cheap to script and creates rows, so it is limited harder than
    // sign-in: three accounts per address per hour.
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const limit = checkAll(authAttemptKeys('signup', tenantId, email || phone || '', ip), 3, 60 * 60);
    if (!limit.ok) return { error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

    const verdict = await verifyCaptcha(org.id, String(formData.get('captchaToken') ?? '') || null, 'signup', ip);
    if (!verdict.ok) return { error: CAPTCHA_REFUSED };

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
    // The second contact has to be free too: the table keeps one account per
    // mobile and per email, and finding that out from a failed insert would
    // read as "something went wrong" rather than as the reason.
    const secondary = primary === 'PHONE' ? (email ? { email } : null) : phone ? { phone } : null;
    if (secondary) {
      const taken = await db.user.findFirst({ where: { organizationId: org.id, deletedAt: null, ...secondary }, select: { id: true } });
      if (taken) return { error: 'email' in secondary ? 'That email address is already on another account here. Sign in, or leave it out.' : 'That mobile number is already on another account here. Sign in, or leave it out.' };
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

    // The contact they did not sign up with gets a code straight away when
    // the academy wants it confirmed; the account page takes the code.
    const second = primary === 'PHONE' ? email : phone;
    if (second && (await settingBool(org.id, 'auth.verifySecondary'))) {
      await sendOtp({ organizationId: org.id, target: second, purpose: 'secondary_validation', userId: user.id }).catch(() => undefined);
    }

    await happened({
      organizationId: org.id,
      key: 'account.created',
      userId: user.id,
      subjectId: user.id,
      data: { name, email: email || null, phone: phone || null },
    });
    await notifyLearner({
      organizationId: org.id,
      eventKey: 'account.welcome',
      userId: user.id,
      subjectId: user.id,
      context: { organization: org.name, loginUrl: '/login', identifier: email || phone || '' },
    });

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
  // Somebody sent here on the way to something (a free paper) goes back to it.
  const next = await takeNextPath();
  redirect(next ? `${next}${next.includes('?') ? '&' : '?'}welcome=1` : '/learn?welcome=1');
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
