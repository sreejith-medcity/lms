'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser, requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { happened, notifyLearner } from '@/lib/events';
import { NOTE_MAX, REASON_MAX, anonymisedUser, canClose, deletionRequestProblem } from '@/lib/data-rights';
import type { ActionState } from '@/server/courses';

/**
 * Data rights: a learner asks to be forgotten, withdraws the ask, and the
 * office closes it one way or the other. The export itself is a route
 * (/api/me/export), since it is a file; it records a DONE request as it goes.
 */

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED' || message === 'SIGN_IN_REQUIRED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[data-rights]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/** Learner management is the permission: whoever can archive a learner can forget one. */
async function office(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('learner.learner_management', action)]);
  return { tenant, user };
}

export async function requestDeletion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) throw new Error('SIGN_IN_REQUIRED');
    const reason = String(formData.get('reason') ?? '').trim().slice(0, REASON_MAX);
    if (formData.get('sure') !== 'on') return { error: 'Tick the box to confirm you understand what happens.' };

    const open = await db.dataRequest.findMany({
      where: { userId: user.id, organizationId: tenant.organizationId, status: 'OPEN' },
      select: { kind: true, status: true },
    });
    const problem = deletionRequestProblem(open);
    if (problem) return { error: problem };

    const request = await db.dataRequest.create({
      data: { organizationId: tenant.organizationId, userId: user.id, kind: 'DELETION', reason: reason || null },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'data_request.deletion_asked',
      entity: 'User',
      entityId: user.id,
      after: { requestId: request.id },
    });
    await happened({
      organizationId: tenant.organizationId,
      key: 'data_request.opened',
      userId: user.id,
      subjectId: request.id,
      data: { requestId: request.id, kind: 'DELETION', reason },
    });

    revalidatePath('/learn/account/privacy');
    revalidatePath('/admin/data-requests');
    return { ok: true, message: 'Asked. The academy will get back to you; you can withdraw this until they do.' };
  } catch (err) {
    return fail(err);
  }
}

export async function withdrawDeletion(): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) throw new Error('SIGN_IN_REQUIRED');
    const changed = await db.dataRequest.updateMany({
      where: { userId: user.id, organizationId: tenant.organizationId, kind: 'DELETION', status: 'OPEN' },
      data: { status: 'CANCELLED', handledAt: new Date() },
    });
    if (changed.count === 0) return { error: 'There is nothing open to withdraw.' };
    revalidatePath('/learn/account/privacy');
    revalidatePath('/admin/data-requests');
    return { ok: true, message: 'Withdrawn. Nothing changes.' };
  } catch (err) {
    return fail(err);
  }
}

/** Refuse a deletion, with a reason the learner is told. */
export async function refuseDeletion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await office();
    const requestId = String(formData.get('requestId') ?? '');
    const note = String(formData.get('note') ?? '').trim().slice(0, NOTE_MAX);
    if (note.length < 5) return { error: 'Say why, in a sentence: the learner reads it.' };

    const request = await db.dataRequest.findFirst({
      where: { id: requestId, organizationId: tenant.organizationId, kind: 'DELETION' },
      select: { id: true, status: true, userId: true },
    });
    if (!request) return { error: 'Request not found.' };
    if (!canClose(request.status)) return { error: 'This request is already closed.' };

    await db.dataRequest.update({
      where: { id: request.id },
      data: { status: 'REFUSED', note, handledById: user.id, handledAt: new Date() },
    });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'data_request.refused',
      entity: 'User',
      entityId: request.userId,
      after: { requestId: request.id, note },
    });
    await notifyLearner({
      organizationId: tenant.organizationId,
      eventKey: 'data_request.closed',
      userId: request.userId,
      subjectId: request.id,
      context: { outcome: 'not gone ahead with', note, url: '/learn/account/privacy' },
    });

    revalidatePath('/admin/data-requests');
    revalidatePath('/learn/account/privacy');
    return { ok: true, message: 'Refused, and the learner told.' };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Forget the person. The account is anonymised in place: the id stays so
 * orders, invoices, marks and certificates still add up, and everything
 * that names or reaches the person goes. Not reversible, and the form says so.
 */
export async function anonymiseLearner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await office('delete');
    const requestId = String(formData.get('requestId') ?? '');
    const note = String(formData.get('note') ?? '').trim().slice(0, NOTE_MAX);
    if (formData.get('confirm') !== 'FORGET') return { error: 'Type FORGET to confirm.' };

    const request = await db.dataRequest.findFirst({
      where: { id: requestId, organizationId: tenant.organizationId, kind: 'DELETION' },
      select: { id: true, status: true, userId: true, user: { select: { kind: true, name: true, email: true } } },
    });
    if (!request) return { error: 'Request not found.' };
    if (!canClose(request.status)) return { error: 'This request is already closed.' };
    if (request.user.kind === 'STAFF') return { error: 'A staff account is removed from the team page, not here.' };

    const learnerId = request.userId;

    // Told first, while there is still an address to tell.
    await notifyLearner({
      organizationId: tenant.organizationId,
      eventKey: 'data_request.closed',
      userId: learnerId,
      subjectId: request.id,
      context: { outcome: 'done', note: note || 'Your account has been closed and your personal details removed.', url: '/' },
    });

    await db.$transaction([
      db.dataRequest.update({
        where: { id: request.id },
        data: { status: 'DONE', note: note || null, handledById: user.id, handledAt: new Date() },
      }),
      db.user.update({ where: { id: learnerId }, data: anonymisedUser(learnerId) }),
      db.learnerProfile.deleteMany({ where: { userId: learnerId } }),
      db.customFieldValue.deleteMany({ where: { userId: learnerId } }),
      db.authSession.deleteMany({ where: { userId: learnerId } }),
      db.authAccount.deleteMany({ where: { userId: learnerId } }),
      db.otpToken.deleteMany({ where: { userId: learnerId } }),
      db.pushSubscription.deleteMany({ where: { userId: learnerId, organizationId: tenant.organizationId } }),
      db.learnerNote.deleteMany({ where: { userId: learnerId } }),
      db.aiConversation.deleteMany({ where: { userId: learnerId } }),
      db.cart.deleteMany({ where: { userId: learnerId, organizationId: tenant.organizationId } }),
      // Their words stay only where the class is still reading them; the name on them is gone anyway.
      db.testimonial.updateMany({ where: { userId: learnerId, organizationId: tenant.organizationId }, data: { isPublished: false, authorName: 'A former learner', authorEmail: null } }),
      db.enrollment.updateMany({
        where: { userId: learnerId, organizationId: tenant.organizationId, status: { in: ['ENROLLED', 'ON_LEAVE', 'REGISTERED'] } },
        data: { status: 'ARCHIVED' },
      }),
    ]);

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'data_request.anonymised',
      entity: 'User',
      entityId: learnerId,
      // The audit keeps the fact, not the person: no name, no email.
      after: { requestId: request.id },
    });
    await happened({
      organizationId: tenant.organizationId,
      key: 'data_request.closed',
      userId: learnerId,
      subjectId: request.id,
      data: { requestId: request.id, outcome: 'DONE' },
    });

    revalidatePath('/admin/data-requests');
    revalidatePath('/admin/learners');
    revalidatePath(`/admin/learners/${learnerId}`);
    return { ok: true, message: 'Done. The account is anonymised and closed.' };
  } catch (err) {
    return fail(err);
  }
}
