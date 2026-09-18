'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { maskContact } from '@/lib/parents';
import type { ActionState } from '@/server/courses';

/**
 * The office's side of the lost-phone problem: sign a parent or a member
 * of staff out of every device. A teacher who leaves, a parent whose phone
 * was stolen, a shared tablet at a branch. The person's next request lands
 * on the sign-in page; nothing about a learner stays readable.
 */

async function guard() {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('settings.organization', 'edit')]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to end sessions.' };
  console.error('[sessions-admin]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function revokeParentSessions(contact: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const [sessions, pushes] = await Promise.all([
      db.parentSession.deleteMany({ where: { organizationId: tenant.organizationId, contact } }),
      db.parentPushSubscription.deleteMany({ where: { organizationId: tenant.organizationId, contact } }),
    ]);
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'parent.sessions_revoked', entity: 'ParentSession', entityId: null, after: { contact: maskContact(contact), sessions: sessions.count, push: pushes.count } });
    revalidatePath('/admin/settings/sessions');
    return { ok: true, message: `${sessions.count} session${sessions.count === 1 ? '' : 's'} ended for ${maskContact(contact)}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeStaffSessions(userId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const person = await db.user.findFirst({ where: { id: userId, organizationId: tenant.organizationId }, select: { id: true, name: true } });
    if (!person) return { error: 'Person not found.' };
    const [sessions, pushes] = await Promise.all([
      db.authSession.deleteMany({ where: { userId: person.id, user: { organizationId: tenant.organizationId } } }),
      db.pushSubscription.deleteMany({ where: { organizationId: tenant.organizationId, userId: person.id } }),
    ]);
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'user.sessions_revoked', entity: 'User', entityId: person.id, after: { sessions: sessions.count, push: pushes.count } });
    revalidatePath('/admin/settings/sessions');
    return { ok: true, message: `${sessions.count} session${sessions.count === 1 ? '' : 's'} ended for ${person.name}.` };
  } catch (err) {
    return fail(err);
  }
}
