'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { captionFileProblem, parseCaptions } from '@/lib/captions';
import { pullCaptions, requestCaptions, saveTranscript } from '@/lib/transcripts';
import type { ActionState } from '@/server/courses';

/**
 * Captions on a file in the media library: handed in as .vtt or .srt,
 * asked of the video platform, pulled in when written, or removed.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('asset_library.manage_assets', action)]);
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  if (message === 'NOT_FOUND') return { error: 'File not found.' };
  console.error('[transcripts]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function uploadCaptions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const assetId = String(formData.get('assetId') ?? '');
    const language = (String(formData.get('language') ?? 'en').trim() || 'en').slice(0, 10);
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'Choose a caption file first.' };
    const problem = captionFileProblem(file.name, file.size);
    if (problem) return { error: problem };

    const segments = parseCaptions(await file.text());
    if (segments.length === 0) return { error: 'No cues were found in that file. It should be WebVTT or SRT.' };

    const { words } = await saveTranscript({ organizationId: tenant.organizationId, assetId, segments, language, source: 'UPLOAD' });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'transcript.uploaded',
      entity: 'Asset',
      entityId: assetId,
      after: { language, segments: segments.length, words },
    });
    revalidatePath('/admin/library');
    return { ok: true, message: `Captions saved: ${segments.length} cues, ${words} words.` };
  } catch (err) {
    return fail(err);
  }
}

export async function generateCaptions(assetId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();
    const result = await requestCaptions(tenant.organizationId, assetId);
    revalidatePath('/admin/library');
    return result.ok ? { ok: true, message: 'Asked. The platform writes them in a few minutes; press Pull to bring them in.' } : { error: result.error };
  } catch (err) {
    return fail(err);
  }
}

export async function pullCaptionsNow(assetId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();
    const outcome = await pullCaptions(tenant.organizationId, assetId);
    revalidatePath('/admin/library');
    if (outcome === 'SAVED') return { ok: true, message: 'Captions are in.' };
    if (outcome === 'NOT_YET') return { ok: true, message: 'Not written yet. Try again in a minute.' };
    if (outcome === 'FAILED') return { error: 'The platform did not answer. Try again shortly.' };
    return { error: 'Nothing was asked for on this file.' };
  } catch (err) {
    return fail(err);
  }
}

export async function removeTranscript(assetId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');
    const gone = await db.transcript.deleteMany({ where: { assetId, asset: { organizationId: tenant.organizationId } } });
    if (gone.count === 0) return { error: 'There is no transcript on this file.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'transcript.removed', entity: 'Asset', entityId: assetId });
    revalidatePath('/admin/library');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
