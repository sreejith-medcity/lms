'use server';

import { cookies, headers } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { SESSION_COOKIE, requireStaff, getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import {
  IMPERSONATOR_COOKIE,
  IMPERSONATION_MINUTES,
  currentImpersonation,
} from '@/lib/impersonation';
import type { ActionState } from '@/server/courses';

/**
 * Support access to a learner's own view.
 *
 * "It does not show up for me" is unanswerable from the admin side, because the
 * admin side is a different application. This is the answer, kept narrow: an
 * hour, learners only, inside your own academy, both ends on the record.
 */

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[learners]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function impersonate(userId: string): Promise<ActionState> {
  let destination: string | null = null;

  try {
    const [tenant, staff] = await Promise.all([
      requireTenant(),
      requireStaff('learner.learner_impersonate', 'edit'),
    ]);
    if (staff.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');

    const jar = await cookies();
    if (jar.get(IMPERSONATOR_COOKIE)) {
      return { error: 'You are already signed in as somebody. Return to admin first.' };
    }

    const learner = await db.user.findFirst({
      where: {
        id: userId,
        organizationId: tenant.organizationId,
        kind: 'LEARNER',
        deletedAt: null,
      },
      select: { id: true, name: true },
    });
    if (!learner) return { error: 'Learner not found.' };

    const own = jar.get(SESSION_COOKIE)?.value;
    if (!own) return { error: 'Please sign in again.' };

    const h = await headers();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + IMPERSONATION_MINUTES * 60_000);

    await db.authSession.create({
      data: {
        userId: learner.id,
        sessionToken: token,
        expiresAt,
        ip: h.get('x-forwarded-for')?.split(',')[0]?.trim(),
        // No column for this, so the trace goes where a human will read it.
        userAgent: `impersonated by ${staff.name} (${staff.id})`,
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: staff.id,
      action: 'learner.impersonation.started',
      entity: 'User',
      entityId: learner.id,
      after: { learner: learner.name, minutes: IMPERSONATION_MINUTES },
    });

    const secure = process.env.NODE_ENV === 'production';
    jar.set(IMPERSONATOR_COOKIE, own, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      expires: expiresAt,
    });
    jar.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      expires: expiresAt,
    });

    destination = '/learn';
  } catch (err) {
    return fail(err);
  }

  if (destination) redirect(destination);
  return { ok: true };
}

export async function stopImpersonating(): Promise<ActionState> {
  let destination: string | null = null;

  try {
    const jar = await cookies();
    const original = jar.get(IMPERSONATOR_COOKIE)?.value;
    if (!original) return { error: 'You are not signed in as anybody.' };

    const back = await currentImpersonation();
    const learner = await getSessionUser();
    const borrowed = jar.get(SESSION_COOKIE)?.value;

    // The borrowed session is thrown away rather than left to expire.
    if (borrowed && borrowed !== original) {
      await db.authSession.deleteMany({ where: { sessionToken: borrowed } });
    }

    if (back && learner) {
      const tenant = await requireTenant();
      await recordAudit({
        organizationId: tenant.organizationId,
        actorId: back.staffId,
        action: 'learner.impersonation.ended',
        entity: 'User',
        entityId: learner.id,
        after: { learner: learner.name },
      });
    }

    const session = await db.authSession.findUnique({
      where: { sessionToken: original },
      select: { expiresAt: true },
    });

    jar.delete(IMPERSONATOR_COOKIE);
    jar.set(SESSION_COOKIE, original, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: session?.expiresAt ?? new Date(Date.now() + 864e5),
    });

    destination = '/admin/learners';
  } catch (err) {
    return fail(err);
  }

  if (destination) redirect(destination);
  return { ok: true };
}
