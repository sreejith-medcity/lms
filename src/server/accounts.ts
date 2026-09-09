'use server';

import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { resolveTenantByHost } from '@/lib/tenant';
import type { ActionState } from '@/server/courses';

const SESSION_DAYS = 30;

const signup = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: z.string().trim().max(20).optional(),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
});

export async function register(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const h = await headers();
    const tenantId = await resolveTenantByHost(h.get('host') ?? '');
    if (!tenantId) return { error: 'This hostname is not linked to an academy.' };

    const org = await db.organization.findFirst({ where: { tenantId }, select: { id: true } });
    if (!org) return { error: 'This hostname is not linked to an academy.' };

    const parsed = signup.safeParse({
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone') || undefined,
      password: formData.get('password'),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const { name, email, phone, password } = parsed.data;

    const existing = await db.user.findFirst({
      where: { organizationId: org.id, email, deletedAt: null },
      select: { id: true },
    });
    if (existing) return { error: 'An account with that email already exists. Try signing in.' };

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
        email,
        phone: phone || null,
        passwordHash: await hashPassword(password),
        kind: 'LEARNER',
        status: 'REGISTERED',
        registrationNo: (last?.registrationNo ?? 0) + 1,
        learnerProfile: { create: {} },
      },
      select: { id: true },
    });

    await startSession(user.id, h.get('user-agent'), h.get('x-forwarded-for'));
  } catch (err) {
    console.error('[accounts]', err instanceof Error ? err.message : err);
    return { error: 'Could not create the account. Please try again.' };
  }

  redirect('/learn');
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
