'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { saveFieldValues } from '@/lib/custom-fields';
import { clearFieldFile, storeFieldFile } from '@/lib/custom-field-files';
import type { ActionState } from '@/server/courses';

/**
 * The office editing what the academy's own fields say about a learner,
 * and keeping the documents they handed in: an ID proof, a photograph, a
 * certificate. Gated on learner management; the learner's own page can
 * edit the same fields for themselves.
 */

async function guard() {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('learner.learner_management', 'edit')]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[learner-fields]', message);
  return { error: 'Something went wrong. Please try again.' };
}

async function ownedLearner(organizationId: string, learnerId: string) {
  return db.user.findFirst({ where: { id: learnerId, organizationId, kind: 'LEARNER' }, select: { id: true, name: true } });
}

export async function saveLearnerFields(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const learnerId = String(formData.get('learnerId') ?? '');
    const learner = await ownedLearner(tenant.organizationId, learnerId);
    if (!learner) return { error: 'Learner not found.' };

    const values: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('cf_') && typeof value === 'string') values[key.slice(3)] = value;
    }
    for (const key of formData.getAll('cf_booleans').map(String)) if (!(key in values)) values[key] = 'false';
    if (Object.keys(values).length === 0) return { error: 'Nothing to save.' };

    await saveFieldValues({ organizationId: tenant.organizationId, entity: 'LEARNER', entityId: learner.id, userId: learner.id, values });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'learner.fields_updated', entity: 'User', entityId: learner.id, after: { keys: Object.keys(values) } });
    revalidatePath(`/admin/learners/${learner.id}`);
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function uploadLearnerDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const learnerId = String(formData.get('learnerId') ?? '');
    const key = String(formData.get('key') ?? '');
    const file = formData.get('file');
    const learner = await ownedLearner(tenant.organizationId, learnerId);
    if (!learner) return { error: 'Learner not found.' };
    if (!(file instanceof File)) return { error: 'Pick a file first.' };

    const stored = await storeFieldFile({ organizationId: tenant.organizationId, entity: 'LEARNER', entityId: learner.id, userId: learner.id, uploaderId: user.id, key, file });
    if (!stored.ok) return { error: stored.error };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'learner.document_uploaded', entity: 'User', entityId: learner.id, after: { key, fileName: stored.file.fileName } });
    revalidatePath(`/admin/learners/${learner.id}`);
    return { ok: true, message: 'Filed.' };
  } catch (err) {
    return fail(err);
  }
}

export async function removeLearnerDocument(learnerId: string, key: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const learner = await ownedLearner(tenant.organizationId, learnerId);
    if (!learner) return { error: 'Learner not found.' };
    const cleared = await clearFieldFile({ organizationId: tenant.organizationId, entity: 'LEARNER', entityId: learner.id, key });
    if (!cleared) return { error: 'That is not a file field.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'learner.document_removed', entity: 'User', entityId: learner.id, after: { key } });
    revalidatePath(`/admin/learners/${learner.id}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
