'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { clearParentSession, endAllParentSessions, getParentSession } from '@/lib/parent-session';
import { recordAudit } from '@/lib/audit';
import { maskContact } from '@/lib/parents';
import type { ActionState } from '@/server/courses';

/**
 * The parent's own controls: reading their inbox, push on this browser,
 * and signing every device out at once (the lost-phone button). Each one
 * is bound to the session's contact; nothing here takes a contact as an
 * argument.
 */

async function me() {
  const tenant = await requireTenant();
  const session = await getParentSession();
  if (!session || session.organizationId !== tenant.organizationId) throw new Error('UNAUTHORIZED');
  return { tenant, session };
}

export async function markParentNotificationRead(id: string): Promise<ActionState> {
  try {
    const { tenant, session } = await me();
    await db.parentNotification.updateMany({ where: { id, organizationId: tenant.organizationId, contact: session.contact, readAt: null }, data: { readAt: new Date() } });
    revalidatePath('/parent/notices');
    return { ok: true };
  } catch {
    return { error: 'Please sign in again.' };
  }
}

export async function markAllParentNotificationsRead(): Promise<ActionState> {
  try {
    const { tenant, session } = await me();
    await db.parentNotification.updateMany({ where: { organizationId: tenant.organizationId, contact: session.contact, readAt: null }, data: { readAt: new Date() } });
    revalidatePath('/parent/notices');
    return { ok: true };
  } catch {
    return { error: 'Please sign in again.' };
  }
}

const subscription = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(5).max(200) }),
  userAgent: z.string().max(300).optional(),
});

export async function saveParentPush(input: unknown): Promise<ActionState> {
  try {
    const { tenant, session } = await me();
    const parsed = subscription.safeParse(input);
    if (!parsed.success) return { error: 'That subscription could not be read.' };
    const d = parsed.data;
    await db.parentPushSubscription.upsert({
      where: { endpoint: d.endpoint },
      create: { organizationId: tenant.organizationId, contact: session.contact, endpoint: d.endpoint, p256dh: d.keys.p256dh, auth: d.keys.auth, userAgent: d.userAgent ?? null },
      update: { organizationId: tenant.organizationId, contact: session.contact, p256dh: d.keys.p256dh, auth: d.keys.auth, userAgent: d.userAgent ?? null },
    });
    return { ok: true, message: 'This device will be told. The lock screen shows the child\'s name and nothing more.' };
  } catch {
    return { error: 'Please sign in again.' };
  }
}

export async function removeParentPush(endpoint: string): Promise<ActionState> {
  try {
    const { tenant, session } = await me();
    await db.parentPushSubscription.deleteMany({ where: { endpoint, organizationId: tenant.organizationId, contact: session.contact } });
    return { ok: true };
  } catch {
    return { error: 'Please sign in again.' };
  }
}

/** Every device signed out, push subscriptions dropped, and this browser sent to sign in. */
export async function signOutParentEverywhere(): Promise<void> {
  const { tenant, session } = await me();
  const ended = await endAllParentSessions(tenant.organizationId, session.contact);
  await db.parentPushSubscription.deleteMany({ where: { organizationId: tenant.organizationId, contact: session.contact } });
  await recordAudit({ organizationId: tenant.organizationId, actorId: null, action: 'parent.signed_out_everywhere', entity: 'ParentSession', entityId: null, after: { contact: maskContact(session.contact), sessions: ended } });
  await clearParentSession();
  redirect('/parent/login?signedout=all');
}
