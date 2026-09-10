import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { db } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/auth';
import { WHO_COOKIE } from '@/lib/who-cookie';
import { resolveTenantByHost } from '@/lib/tenant';
import { adoptGuestBasket, publishBasketCountForUser } from '@/lib/cart';

/**
 * Becoming signed in.
 *
 * Four doors now lead here: a password, a one-time code, Google and Microsoft.
 * They must all produce exactly the same session, refuse a suspended account
 * the same way, and stop at the same second factor, so this is one function
 * rather than four almost-identical ones. The bug this prevents is the ordinary
 * one: two-factor enforced on the password path and forgotten on the others.
 */

const SESSION_DAYS = 30;
/** Long enough to fetch a phone, short enough that a stolen link is useless. */
const PENDING_MINUTES = 10;
const PENDING_COOKIE = 'mlms_pending';

export interface Organisation {
  tenantId: string;
  organizationId: string;
}

/** The academy this hostname belongs to, or null. */
export async function organisationForHost(): Promise<Organisation | null> {
  const h = await headers();
  const tenantId = await resolveTenantByHost(h.get('host') ?? '');
  if (!tenantId) return null;

  const org = await db.organization.findFirst({ where: { tenantId }, select: { id: true } });
  return org ? { tenantId, organizationId: org.id } : null;
}

export type SignInOutcome =
  | { status: 'blocked'; message: string }
  | { status: 'second-factor'; userId: string }
  | { status: 'signed-in'; redirectTo: string };

function activeOrMessage(status: string): string | null {
  if (status === 'SUSPENDED' || status === 'ARCHIVED') {
    return 'This account is not active. Contact your academy.';
  }
  return null;
}

/**
 * Everything after the credential has been accepted.
 *
 * Whoever calls this has already proved who they are, by whichever means. What
 * is left is the checks that do not care how they proved it.
 */
export async function completeSignIn(userId: string): Promise<SignInOutcome> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, kind: true, status: true, twoFactorEnabledAt: true },
  });
  if (!user) return { status: 'blocked', message: 'That account no longer exists.' };

  const blocked = activeOrMessage(user.status);
  if (blocked) return { status: 'blocked', message: blocked };

  if (user.twoFactorEnabledAt) {
    await startPending(user.id);
    return { status: 'second-factor', userId: user.id };
  }

  await issueSession(user.id);
  return { status: 'signed-in', redirectTo: user.kind === 'STAFF' ? '/admin' : '/' };
}

/** The real session cookie. Only ever set once every check has passed. */
export async function issueSession(userId: string): Promise<void> {
  const h = await headers();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);

  await db.authSession.create({
    data: {
      userId,
      sessionToken: token,
      expiresAt,
      ip: h.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: h.get('user-agent') ?? undefined,
    },
  });

  const person = await db.user.update({
    where: { id: userId },
    data: { lastSeenAt: new Date() },
    select: { kind: true, organizationId: true },
  });

  // A basket filled before signing in follows them through the door. Without
  // this, the most common reason somebody signs in at all, to pay for what
  // they just chose, drops them on an empty cart.
  await adoptGuestBasket(person.organizationId, userId);
  await publishBasketCountForUser(person.organizationId, userId);

  const jar = await cookies();
  jar.delete(PENDING_COOKIE);

  // Set beside the session and cleared with it, so the two can never disagree
  // about whether somebody is signed in. Readable on purpose: the header uses
  // it in the browser, and it grants nothing on its own.
  jar.set(WHO_COOKIE, person.kind === 'STAFF' ? 'staff' : 'learner', {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

/**
 * Half signed in.
 *
 * A cookie that says "this person has a password but not yet a second factor".
 * It is not a session: nothing in the product accepts it, `getSessionUser`
 * never looks at it, and it expires in ten minutes. Signed with AUTH_SECRET so
 * a user cannot simply write their own and skip the step.
 */
function pendingSecret(): string {
  return process.env.AUTH_SECRET || 'insecure-development-secret';
}

function stamp(userId: string, expiresAt: number): string {
  return createHash('sha256')
    .update(`${pendingSecret()}:${userId}:${expiresAt}`)
    .digest('hex');
}

async function startPending(userId: string): Promise<void> {
  const expiresAt = Date.now() + PENDING_MINUTES * 60_000;
  const value = `${userId}.${expiresAt}.${stamp(userId, expiresAt)}`;

  (await cookies()).set(PENDING_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function pendingUserId(): Promise<string | null> {
  const raw = (await cookies()).get(PENDING_COOKIE)?.value;
  if (!raw) return null;

  const [userId, expiry, signature] = raw.split('.');
  if (!userId || !expiry || !signature) return null;

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const expected = Buffer.from(stamp(userId, expiresAt));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  return userId;
}

export async function clearPending(): Promise<void> {
  (await cookies()).delete(PENDING_COOKIE);
}

/** Where to send somebody once they are through. */
export async function landingFor(userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { kind: true } });
  return user?.kind === 'STAFF' ? '/admin' : '/';
}
