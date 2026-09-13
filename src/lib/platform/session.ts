import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';

/**
 * The platform console's own sign-in. A signed cookie rather than a table:
 * the console has a handful of users and no reason to revoke a session
 * early that changing the password does not cover (the hash is part of
 * the signature, so a password change signs everybody out).
 */

export const PLATFORM_COOKIE = 'mlms_platform';
const DAYS = 14;

export interface PlatformSession {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ENGINEER' | 'SUPPORT' | 'BILLING' | 'READ_ONLY';
}

function secret(): string {
  return process.env.AUTH_SECRET ?? 'insecure-development-secret';
}

function sign(payload: string, passwordHash: string | null): string {
  return createHmac('sha256', secret()).update(`${payload}|${passwordHash ?? ''}`).digest('base64url');
}

export function mintToken(userId: string, passwordHash: string | null, now = Date.now()): string {
  const expires = now + DAYS * 864e5;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload, passwordHash)}`;
}

/** Whether this request is on the platform host at all. */
export async function onPlatformHost(): Promise<boolean> {
  const h = await headers();
  if (h.get('x-platform') === '1') return true;
  const host = (h.get('host') ?? '').split(':')[0].toLowerCase();
  const platformHost = (process.env.PLATFORM_HOST ?? '').split(':')[0].toLowerCase();
  return Boolean(platformHost) && host === platformHost;
}

export const getPlatformUser = cache(async (): Promise<PlatformSession | null> => {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!token) return null;
  const [userId, expiresRaw, sig] = token.split('.');
  if (!userId || !expiresRaw || !sig) return null;
  if (Number(expiresRaw) < Date.now()) return null;
  const user = await db.platformUser.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, role: true, isActive: true, passwordHash: true } });
  if (!user || !user.isActive) return null;
  const expected = sign(`${userId}.${expiresRaw}`, user.passwordHash);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
});

export async function issuePlatformSession(userId: string, passwordHash: string | null): Promise<void> {
  const token = mintToken(userId, passwordHash);
  (await cookies()).set(PLATFORM_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: DAYS * 86400 });
  await db.platformUser.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
}

export async function clearPlatformSession(): Promise<void> {
  (await cookies()).delete(PLATFORM_COOKIE);
}

const CAN_WRITE = new Set(['OWNER', 'ENGINEER', 'SUPPORT', 'BILLING']);

/** The signed-in platform user, or a throw the page turns into a redirect. */
export async function requirePlatform(write = false): Promise<PlatformSession> {
  const user = await getPlatformUser();
  if (!user) throw new Error('PLATFORM_SIGN_IN');
  if (write && !CAN_WRITE.has(user.role)) throw new Error('FORBIDDEN');
  return user;
}
