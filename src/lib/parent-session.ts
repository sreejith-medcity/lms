import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { settingNumber } from '@/lib/settings/store';

/**
 * The parent's session: a cookie of its own, separate from a learner's or
 * staff's, so a parent signed in on the family laptop is never mistaken for
 * the child and a child never sees the parent's view.
 */

export const PARENT_COOKIE = 'mlms_parent';

export interface ParentSession {
  id: string;
  organizationId: string;
  contact: string;
}

export const getParentSession = cache(async (): Promise<ParentSession | null> => {
  const token = (await cookies()).get(PARENT_COOKIE)?.value;
  if (!token) return null;
  const row = await db.parentSession.findUnique({ where: { token }, select: { id: true, organizationId: true, contact: true, expiresAt: true, lastSeenAt: true } });
  if (!row || row.expiresAt < new Date()) return null;
  const tenant = await getTenantContext();
  if (!tenant || row.organizationId !== tenant.organizationId) return null;
  // "Last seen" on the account page, kept to the hour so a busy page is not a write per request.
  if (Date.now() - row.lastSeenAt.getTime() > 36e5) {
    db.parentSession.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return { id: row.id, organizationId: row.organizationId, contact: row.contact };
});

/**
 * The session, or a redirect to sign in that says why: a phone that held a
 * session which has since expired or been signed out everywhere lands on
 * "signed out" rather than a blank sign-in, so a parent who did nothing
 * wrong is told so.
 */
export async function requireParentSession(): Promise<ParentSession> {
  const session = await getParentSession();
  if (session) return session;
  const hadCookie = Boolean((await cookies()).get(PARENT_COOKIE)?.value);
  redirect(hadCookie ? '/parent/login?expired=1' : '/parent/login');
}

/** Sign this contact out of every device, this one included. */
export async function endAllParentSessions(organizationId: string, contact: string): Promise<number> {
  const r = await db.parentSession.deleteMany({ where: { organizationId, contact } });
  return r.count;
}

export async function issueParentSession(organizationId: string, contact: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const days = await settingNumber(organizationId, 'auth.parentSessionDays').catch(() => 30);
  const expiresAt = new Date(Date.now() + Math.max(1, days || 30) * 864e5);
  const userAgent = (await headers()).get('user-agent')?.slice(0, 300) ?? null;
  await db.parentSession.create({ data: { organizationId, contact, token, expiresAt, userAgent } });
  (await cookies()).set(PARENT_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearParentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(PARENT_COOKIE)?.value;
  if (token) {
    // The token is unique across academies, so this cannot reach another's row;
    // the academy is named anyway, the way every query here is.
    const tenant = await getTenantContext();
    if (tenant) await db.parentSession.deleteMany({ where: { token, organizationId: tenant.organizationId } });
  }
  jar.delete(PARENT_COOKIE);
}

/**
 * The learners this contact is linked to. Only an active `ParentLink`
 * counts: a phone number that merely appears on a learner's record opens
 * nothing until the office has linked it, and a revoked link closes the
 * child on the parent's next request.
 */
export async function childrenOf(organizationId: string, contact: string) {
  return db.user.findMany({
    where: {
      organizationId,
      kind: 'LEARNER',
      deletedAt: null,
      parentLinks: { some: { organizationId, contact, status: 'ACTIVE' } },
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, avatarUrl: true, registrationNo: true, learnerProfile: { select: { parentName: true } } },
  });
}

/**
 * Links made from the learner's own record, for contacts that have never
 * been linked or revoked. Run when a parent asks for a code, so a parent
 * who could sign in before links existed still can, while a revoked
 * contact stays revoked: the office's decision is never undone by a form.
 */
export async function linkFromRecords(organizationId: string, contact: string): Promise<number> {
  const byEmail = contact.includes('@');
  const learners = await db.user.findMany({
    where: {
      organizationId,
      kind: 'LEARNER',
      deletedAt: null,
      learnerProfile: byEmail ? { parentEmail: { equals: contact, mode: 'insensitive' } } : { parentPhone: { endsWith: contact } },
      parentLinks: { none: { contact } },
    },
    select: { id: true, learnerProfile: { select: { parentName: true } } },
    take: 20,
  });
  if (learners.length === 0) return 0;
  await db.parentLink.createMany({
    data: learners.map((l) => ({
      organizationId,
      learnerId: l.id,
      contact,
      name: l.learnerProfile?.parentName?.trim() || 'Parent',
      status: 'ACTIVE' as const,
      verifiedHow: 'record',
      verifiedAt: new Date(),
    })),
    skipDuplicates: true,
  });
  return learners.length;
}

/** One child, only if this session's contact is on their record. */
export async function childOf(organizationId: string, contact: string, childId: string) {
  const all = await childrenOf(organizationId, contact);
  return all.find((c) => c.id === childId) ?? null;
}
