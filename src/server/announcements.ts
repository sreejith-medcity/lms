'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import type { ActionState } from '@/server/courses';

/**
 * Announcements.
 *
 * Targeted at batches rather than blasted at everyone, because an announcement
 * that does not apply to you teaches you to ignore the next one. Nothing is sent
 * anywhere: messaging is not connected, so these appear inside the platform and
 * the page says so rather than implying an email went out.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('announcements.manage_announcements', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to post announcements.' };
  console.error('[announcements]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const announcement = z.object({
  title: z.string().trim().min(3, 'Give it a title').max(160),
  bodyHtml: z.string().trim().min(3, 'Write the announcement').max(4000),
  urgency: z.enum(['HIGH', 'NORMAL']),
  publishAt: z.string().optional().or(z.literal('')),
});

export async function postAnnouncement(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const parsed = announcement.safeParse({
      title: formData.get('title'),
      bodyHtml: formData.get('bodyHtml'),
      urgency: formData.get('urgency') || 'NORMAL',
      publishAt: formData.get('publishAt') || '',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const batchIds = formData.getAll('batchId').map((v) => String(v)).filter(Boolean);

    const valid = await db.batch.findMany({
      where: { id: { in: batchIds }, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true },
    });

    await db.announcement.create({
      data: {
        organizationId: tenant.organizationId,
        title: d.title,
        bodyHtml: d.bodyHtml,
        urgency: d.urgency,
        publishAt: d.publishAt ? new Date(d.publishAt) : new Date(),
        createdById: user.id,
        targets: valid.length
          ? { create: valid.map((b) => ({ batchId: b.id })) }
          : { create: [{}] }, // no batch: everyone
      },
    });

    revalidatePath('/admin/announcements');
    revalidatePath('/learn');
    return {
      ok: true,
      message: valid.length
        ? `Posted to ${valid.length} batch${valid.length === 1 ? '' : 'es'}.`
        : 'Posted to everyone.',
    };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteAnnouncement(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');
    await db.announcement.deleteMany({ where: { id, organizationId: tenant.organizationId } });
    revalidatePath('/admin/announcements');
    revalidatePath('/learn');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
