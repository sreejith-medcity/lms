'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import type { ActionState } from '@/server/courses';

/**
 * Giving one candidate more than their course includes.
 *
 * Three shapes, because the office asked for three and they are genuinely
 * different: a test their course does not have, more goes at a test it does,
 * and an allowance over a set of tests they choose from. All three are per
 * learner, so nothing here loosens a test for everybody, which is the way
 * this usually gets done and the way it goes wrong.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('courses.assessments', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[assessment grants]', message);
  return { error: 'Something went wrong. Please try again.' };
}

function dateOrNull(value: FormDataEntryValue | null): Date | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? null : at;
}

export async function grantAssessment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const userId = String(formData.get('userId') ?? '');
    const assessmentId = String(formData.get('assessmentId') ?? '');
    const extraAttempts = Math.max(0, Math.min(20, Number(formData.get('extraAttempts') ?? 0) || 0));
    const note = String(formData.get('note') ?? '').trim();
    const opensAt = dateOrNull(formData.get('opensAt'));
    const closesAt = dateOrNull(formData.get('closesAt'));

    if (!userId || !assessmentId) return { error: 'Pick a learner and a test.' };
    if (opensAt && closesAt && opensAt >= closesAt) {
      return { error: 'The window has to open before it closes.' };
    }

    const [learner, assessment] = await Promise.all([
      db.user.findFirst({
        where: { id: userId, organizationId: tenant.organizationId, deletedAt: null },
        select: { id: true, name: true },
      }),
      db.assessment.findFirst({
        where: { id: assessmentId, organizationId: tenant.organizationId },
        select: { id: true, title: true, maxAttempts: true },
      }),
    ]);
    if (!learner) return { error: 'That learner was not found.' };
    if (!assessment) return { error: 'That test was not found.' };

    await db.assessmentGrant.upsert({
      where: { assessmentId_userId: { assessmentId, userId } },
      create: {
        organizationId: tenant.organizationId,
        assessmentId,
        userId,
        isAssigned: true,
        extraAttempts,
        opensAt,
        closesAt,
        note: note || null,
        grantedById: user.id,
      },
      update: {
        isAssigned: true,
        extraAttempts,
        opensAt,
        closesAt,
        note: note || null,
        grantedById: user.id,
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'assessment.granted',
      entity: 'Assessment',
      entityId: assessmentId,
      after: { userId, extraAttempts, opensAt, closesAt },
    });

    revalidatePath(`/admin/learners/${userId}`);

    const total = assessment.maxAttempts + extraAttempts;
    return {
      ok: true,
      message: `${learner.name} has ${assessment.title} with ${total} attempt${total === 1 ? '' : 's'}.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function withdrawAssessmentGrant(grantId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');

    const grant = await db.assessmentGrant.findFirst({
      where: { id: grantId, organizationId: tenant.organizationId },
      select: { id: true, userId: true, assessmentId: true },
    });
    if (!grant) return { error: 'That was not found.' };

    await db.assessmentGrant.delete({ where: { id: grant.id } });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'assessment.grant_withdrawn',
      entity: 'Assessment',
      entityId: grant.assessmentId,
      after: { userId: grant.userId },
    });

    revalidatePath(`/admin/learners/${grant.userId}`);
    return { ok: true, message: 'Withdrawn. Attempts already made are kept.' };
  } catch (err) {
    return fail(err);
  }
}

/* Pools ------------------------------------------------------------------- */

export async function savePool(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim();
    const assessmentIds = formData.getAll('assessmentIds').map((v) => String(v)).filter(Boolean);

    if (name.length < 2) return { error: 'Give the set a name.' };
    if (assessmentIds.length === 0) return { error: 'Put at least one test in it.' };

    const valid = await db.assessment.findMany({
      where: { id: { in: assessmentIds }, organizationId: tenant.organizationId },
      select: { id: true },
    });

    const pool = id
      ? await db.assessmentPool.update({
          where: { id },
          data: { name, description: description || null },
          select: { id: true },
        })
      : await db.assessmentPool.create({
          data: { organizationId: tenant.organizationId, name, description: description || null },
          select: { id: true },
        });

    // Replaced wholesale, so removing one from the set is the same press as
    // adding one. Allowances already given are untouched: they are a number
    // of tests, not a list of them.
    await db.assessmentPoolItem.deleteMany({ where: { poolId: pool.id } });
    await db.assessmentPoolItem.createMany({
      data: valid.map((a, i) => ({ poolId: pool.id, assessmentId: a.id, sortOrder: i })),
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: id ? 'assessment_pool.updated' : 'assessment_pool.created',
      entity: 'AssessmentPool',
      entityId: pool.id,
      after: { name, tests: valid.length },
    });

    revalidatePath('/admin/assessments/pools');
    return { ok: true, message: `${name}: ${valid.length} test${valid.length === 1 ? '' : 's'}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function grantPool(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const userId = String(formData.get('userId') ?? '');
    const poolId = String(formData.get('poolId') ?? '');
    const allowance = Math.max(1, Math.min(100, Number(formData.get('allowance') ?? 1) || 1));
    const expiresAt = dateOrNull(formData.get('expiresAt'));
    const note = String(formData.get('note') ?? '').trim();

    if (!userId || !poolId) return { error: 'Pick a learner and a set.' };

    const [learner, pool] = await Promise.all([
      db.user.findFirst({
        where: { id: userId, organizationId: tenant.organizationId, deletedAt: null },
        select: { id: true, name: true },
      }),
      db.assessmentPool.findFirst({
        where: { id: poolId, organizationId: tenant.organizationId },
        select: { id: true, name: true, _count: { select: { items: true } } },
      }),
    ]);
    if (!learner) return { error: 'That learner was not found.' };
    if (!pool) return { error: 'That set was not found.' };

    await db.assessmentPoolGrant.upsert({
      where: { poolId_userId: { poolId, userId } },
      create: {
        organizationId: tenant.organizationId,
        poolId,
        userId,
        allowance,
        expiresAt,
        note: note || null,
        grantedById: user.id,
      },
      update: { allowance, expiresAt, note: note || null, grantedById: user.id },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'assessment_pool.granted',
      entity: 'AssessmentPool',
      entityId: poolId,
      after: { userId, allowance, expiresAt },
    });

    revalidatePath(`/admin/learners/${userId}`);
    return {
      ok: true,
      message: `${learner.name} may take ${allowance} of the ${pool._count.items} tests in ${pool.name}.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function withdrawPoolGrant(grantId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');

    const grant = await db.assessmentPoolGrant.findFirst({
      where: { id: grantId, organizationId: tenant.organizationId },
      select: { id: true, userId: true, poolId: true },
    });
    if (!grant) return { error: 'That was not found.' };

    await db.assessmentPoolGrant.delete({ where: { id: grant.id } });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'assessment_pool.grant_withdrawn',
      entity: 'AssessmentPool',
      entityId: grant.poolId,
      after: { userId: grant.userId },
    });

    revalidatePath(`/admin/learners/${grant.userId}`);
    return { ok: true, message: 'Withdrawn.' };
  } catch (err) {
    return fail(err);
  }
}
