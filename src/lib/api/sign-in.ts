import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { checkOtp } from '@/lib/otp';
import { sendOtp } from '@/lib/otp-delivery';
import { authAttemptKeys, checkAll, resetAll } from '@/lib/rate-limit';

/** The app's sign-in, mirroring the web forms without the cookie. */

export function normaliseIdentifier(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value.includes('@')) return value;
  const digits = value.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export type AppSignIn = { ok: true; userId: string; kind: 'LEARNER' | 'STAFF' } | { ok: false; code: string; message: string; retryAfter?: number };

const BLOCKED = 'This account is not active. Contact your academy.';

export async function signInWithPassword(input: { organizationId: string; tenantId: string; identifier: string; password: string; ip: string | null }): Promise<AppSignIn> {
  const target = normaliseIdentifier(input.identifier);
  if (!target || !input.password) return { ok: false, code: 'missing', message: 'Enter your email or mobile and your password.' };
  const keys = authAttemptKeys('password', input.tenantId, target, input.ip);
  const limit = checkAll(keys, 8, 15 * 60);
  if (!limit.ok) return { ok: false, code: 'too_many', message: 'Too many tries. Wait a few minutes.', retryAfter: limit.retryAfterSeconds };
  const user = await db.user.findFirst({
    where: { organizationId: input.organizationId, deletedAt: null, OR: [{ email: target }, { phone: target }] },
    select: { id: true, kind: true, status: true, passwordHash: true, twoFactorEnabledAt: true },
  });
  const wrong = { ok: false as const, code: 'wrong', message: 'That email or mobile and password do not match.' };
  if (!user?.passwordHash) return wrong;
  if (!(await verifyPassword(input.password, user.passwordHash))) return wrong;
  if (user.status === 'SUSPENDED' || user.status === 'ARCHIVED') return { ok: false, code: 'blocked', message: BLOCKED };
  // Two factor is a web flow; the app hands off to it.
  if (user.twoFactorEnabledAt) return { ok: false, code: 'second_factor', message: 'This account uses a second factor. Sign in on the web once, then use a code here.' };
  resetAll(keys);
  return { ok: true, userId: user.id, kind: user.kind };
}

export async function requestSignInCode(input: { organizationId: string; tenantId: string; identifier: string; ip: string | null }): Promise<{ ok: boolean; message: string; sentTo?: string; retryAfter?: number }> {
  const target = normaliseIdentifier(input.identifier);
  if (!target || (!target.includes('@') && target.length !== 10)) return { ok: false, message: 'Enter your mobile number or your email address.' };
  const keys = authAttemptKeys('otp', input.tenantId, target, input.ip);
  const limit = checkAll(keys, 4, 15 * 60);
  if (!limit.ok) return { ok: false, message: 'Too many codes asked for. Wait a few minutes.', retryAfter: limit.retryAfterSeconds };
  const user = await db.user.findFirst({ where: { organizationId: input.organizationId, deletedAt: null, OR: [{ email: target }, { phone: target }] }, select: { id: true } });
  // The same answer whether or not the account exists.
  if (!user) return { ok: true, message: 'If that account exists, a code is on its way.', sentTo: target.includes('@') ? 'that address' : 'that number' };
  const r = await sendOtp({ organizationId: input.organizationId, target, purpose: 'login', userId: user.id });
  if (!r.ok) return { ok: false, message: r.error ?? 'Could not send a code just now.', retryAfter: r.retryAfter };
  return { ok: true, message: 'A code is on its way.', sentTo: r.sentTo };
}

export async function signInWithCode(input: { organizationId: string; identifier: string; code: string }): Promise<AppSignIn> {
  const target = normaliseIdentifier(input.identifier);
  if (!target || !input.code) return { ok: false, code: 'missing', message: 'Enter the code that was sent to you.' };
  const checked = await checkOtp({ target, purpose: 'login', code: input.code });
  if (!checked.ok || !checked.userId) return { ok: false, code: 'wrong', message: checked.error ?? 'That code is wrong or has expired.' };
  const user = await db.user.findFirst({ where: { id: checked.userId, organizationId: input.organizationId, deletedAt: null }, select: { id: true, kind: true, status: true, emailVerifiedAt: true, phoneVerifiedAt: true } });
  if (!user) return { ok: false, code: 'wrong', message: 'That code is wrong or has expired.' };
  if (user.status === 'SUSPENDED' || user.status === 'ARCHIVED') return { ok: false, code: 'blocked', message: BLOCKED };
  const isEmail = target.includes('@');
  if (isEmail && !user.emailVerifiedAt) await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  if (!isEmail && !user.phoneVerifiedAt) await db.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
  return { ok: true, userId: user.id, kind: user.kind };
}
