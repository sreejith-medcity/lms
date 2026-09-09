import { cookies } from 'next/headers';
import { db } from '@/lib/db';

/**
 * Signing in as a learner, and being visible about it.
 *
 * The staff member's own session token is parked in a second cookie while a
 * short-lived learner session takes its place. Two things follow from that: the
 * impersonated session is an ordinary learner session, so every permission
 * check already in the product applies without a special case, and stopping is
 * just putting the original token back.
 *
 * It is deliberately loud. A banner sits across every learner page, the session
 * lasts an hour, and both ends of it are written to the audit log, because
 * support access that leaves no trace is indistinguishable from a stranger in
 * somebody's account.
 */

export const IMPERSONATOR_COOKIE = 'mlms_impersonator';
export const IMPERSONATION_MINUTES = 60;

export interface Impersonation {
  staffId: string;
  staffName: string;
}

/** Who is really at the keyboard, when it is not the person in the session. */
export async function currentImpersonation(): Promise<Impersonation | null> {
  const token = (await cookies()).get(IMPERSONATOR_COOKIE)?.value;
  if (!token) return null;

  const session = await db.authSession.findUnique({
    where: { sessionToken: token },
    select: { expiresAt: true, user: { select: { id: true, name: true, kind: true } } },
  });

  if (!session || session.expiresAt < new Date() || session.user.kind !== 'STAFF') return null;
  return { staffId: session.user.id, staffName: session.user.name };
}
