'use server';

import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import { resolveTenantByHost } from '@/lib/tenant';

const SESSION_DAYS = 30;

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

  if (user.status === 'SUSPENDED' || user.status === 'ARCHIVED') {
    return { error: 'This account is not active. Contact your academy.' };
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);

  await db.authSession.create({
    data: {
      userId: user.id,
      sessionToken: token,
      expiresAt,
      ip: h.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: h.get('user-agent') ?? undefined,
    },
  });

  await db.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  redirect(user.kind === 'STAFF' ? '/admin' : '/');
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.authSession.deleteMany({ where: { sessionToken: token } });
    jar.delete(SESSION_COOKIE);
  }
  redirect('/login');
}
