'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import type { ActionState } from '@/server/courses';

/** The bell: what a person has been told inside the product, and the browsers that asked to be pushed. */

async function me() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user || user.organizationId !== tenant.organizationId) throw new Error('UNAUTHORIZED');
  return { tenant, user };
}

export async function markNotificationRead(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await me();
    await db.notificationLog.updateMany({
      where: { id, organizationId: tenant.organizationId, userId: user.id, channel: 'IN_APP', status: 'SENT' },
      data: { status: 'READ' },
    });
    revalidatePath('/learn/notifications');
    revalidatePath('/learn', 'layout');
    return { ok: true };
  } catch {
    return { error: 'Please sign in again.' };
  }
}

export async function markAllNotificationsRead(): Promise<ActionState> {
  try {
    const { tenant, user } = await me();
    await db.notificationLog.updateMany({
      where: { organizationId: tenant.organizationId, userId: user.id, channel: 'IN_APP', status: 'SENT' },
      data: { status: 'READ' },
    });
    revalidatePath('/learn/notifications');
    revalidatePath('/learn', 'layout');
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

/** A browser that asked to be told. Stored against the person; several per person is normal. */
export async function savePushSubscription(input: unknown): Promise<ActionState> {
  try {
    const { tenant, user } = await me();
    const parsed = subscription.safeParse(input);
    if (!parsed.success) return { error: 'That subscription could not be read.' };
    const d = parsed.data;
    await db.pushSubscription.upsert({
      where: { endpoint: d.endpoint },
      create: { organizationId: tenant.organizationId, userId: user.id, endpoint: d.endpoint, p256dh: d.keys.p256dh, auth: d.keys.auth, userAgent: d.userAgent ?? null },
      update: { organizationId: tenant.organizationId, userId: user.id, p256dh: d.keys.p256dh, auth: d.keys.auth, userAgent: d.userAgent ?? null },
    });
    return { ok: true, message: 'This device will be told.' };
  } catch {
    return { error: 'Please sign in again.' };
  }
}

export async function removePushSubscription(endpoint: string): Promise<ActionState> {
  try {
    const { tenant, user } = await me();
    await db.pushSubscription.deleteMany({ where: { endpoint, organizationId: tenant.organizationId, userId: user.id } });
    return { ok: true };
  } catch {
    return { error: 'Please sign in again.' };
  }
}
