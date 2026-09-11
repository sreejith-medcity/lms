'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { expiryFromDays } from '@/lib/recording-share';
import type { ActionState } from '@/server/courses';

/**
 * Releasing one class recording to one learner, until a date.
 *
 * The office does this constantly and currently does it by uploading the file
 * somewhere else, which is how a term of classes ends up on a Drive folder
 * nobody can withdraw. A share here names the learner, dies on its date, can
 * be withdrawn in one press, and counts its views, so the recording stays the
 * academy's rather than becoming a file in circulation.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('class_recording.publish_recordings', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[recording share]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export interface ShareResult extends ActionState {
  /** The path to hand over. Absolute is built in the browser, which knows the host. */
  path?: string;
  expiresAt?: string;
}

export async function shareRecording(
  _prev: ShareResult,
  formData: FormData,
): Promise<ShareResult> {
  try {
    const { tenant, user } = await guard();

    const recordingId = String(formData.get('recordingId') ?? '');
    const learnerQuery = String(formData.get('learner') ?? '').trim();
    const days = Number(formData.get('days') ?? 2);
    const maxViewsRaw = String(formData.get('maxViews') ?? '').trim();
    const note = String(formData.get('note') ?? '').trim();

    if (!recordingId) return { error: 'Pick a recording.' };
    if (!learnerQuery) return { error: 'Give the learner’s email or mobile number.' };

    const recording = await db.recording.findFirst({
      where: { id: recordingId, session: { organizationId: tenant.organizationId } },
      select: { id: true, title: true },
    });
    if (!recording) return { error: 'That recording was not found.' };

    // Matched on what the office has to hand, which is an email or a number,
    // not an id they would have to go and look up.
    const digits = learnerQuery.replace(/\D/g, '').slice(-10);
    const learner = await db.user.findFirst({
      where: {
        organizationId: tenant.organizationId,
        deletedAt: null,
        OR: [
          { email: learnerQuery.toLowerCase() },
          ...(digits.length === 10 ? [{ phone: { endsWith: digits } }] : []),
        ],
      },
      select: { id: true, name: true, email: true },
    });
    if (!learner) {
      return {
        error: 'No learner here has that email or number. They need an account before a link can be tied to them.',
      };
    }

    const maxViews = maxViewsRaw ? Math.max(1, Math.min(100, Number(maxViewsRaw))) : null;
    if (maxViewsRaw && !Number.isFinite(Number(maxViewsRaw))) {
      return { error: 'The number of views has to be a number.' };
    }

    const token = randomBytes(24).toString('base64url');
    const expiresAt = expiryFromDays(Number.isFinite(days) ? days : 2);

    await db.recordingShare.create({
      data: {
        organizationId: tenant.organizationId,
        recordingId: recording.id,
        userId: learner.id,
        token,
        note: note || null,
        expiresAt,
        maxViews,
        createdById: user.id,
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'recording.shared',
      entity: 'Recording',
      entityId: recording.id,
      after: { learnerId: learner.id, expiresAt, maxViews },
    });

    revalidatePath('/admin/recordings');

    return {
      ok: true,
      message: `Shared with ${learner.name} until ${expiresAt.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })}.`,
      path: `/learn/shared/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeRecordingShare(shareId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');

    const share = await db.recordingShare.findFirst({
      where: { id: shareId, organizationId: tenant.organizationId },
      select: { id: true, recordingId: true, revokedAt: true },
    });
    if (!share) return { error: 'That link was not found.' };
    if (share.revokedAt) return { ok: true, message: 'Already withdrawn.' };

    await db.recordingShare.update({
      where: { id: share.id },
      data: { revokedAt: new Date() },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'recording.share_revoked',
      entity: 'Recording',
      entityId: share.recordingId,
    });

    revalidatePath('/admin/recordings');
    return { ok: true, message: 'Withdrawn. The link stops working immediately.' };
  } catch (err) {
    return fail(err);
  }
}
