'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { eventDef } from '@/lib/events';
import { isActionType, parseStepConfig, parseTriggerFilters, stepProblem } from '@/lib/workflow-rules';
import { advanceRun } from '@/lib/workflows';
import type { ActionState } from '@/server/courses';

/**
 * Writing an automation down.
 *
 * The steps arrive as one JSON field from the editor rather than forty
 * named inputs, and every step is checked in words before anything is
 * saved: an automation with a message that has no text is refused here,
 * not discovered by the learner it was meant for.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('marketing.workflows', action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[workflows]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const shape = z.object({
  id: z.string().trim().max(60).optional(),
  name: z.string().trim().min(2, 'Give the automation a name.').max(120),
  description: z.string().trim().max(500).optional(),
  triggerType: z.string().trim().min(1, 'Pick what starts it.'),
  runOnce: z.enum(['true', 'false']).default('true'),
  steps: z.string().min(2, 'Add at least one step.'),
});

const stepShape = z.object({
  actionType: z.string(),
  delayMinutes: z.number().min(0).max(525_600).default(0),
  config: z.record(z.string(), z.unknown()).default({}),
});

export async function saveWorkflow(_prev: ActionState, formData: FormData): Promise<ActionState & { id?: string }> {
  try {
    const { tenant, user } = await guard('edit');

    const parsed = shape.safeParse({
      id: formData.get('id') || undefined,
      name: formData.get('name'),
      description: formData.get('description') || undefined,
      triggerType: formData.get('triggerType'),
      runOnce: formData.get('runOnce') === 'false' ? 'false' : 'true',
      steps: formData.get('steps'),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    if (!eventDef(d.triggerType)) return { error: 'That trigger is not one we know.' };

    let rawSteps: unknown;
    try {
      rawSteps = JSON.parse(d.steps);
    } catch {
      return { error: 'The steps could not be read. Reload the page and try again.' };
    }
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) return { error: 'Add at least one step.' };
    if (rawSteps.length > 30) return { error: 'Thirty steps is the most one automation can have.' };

    const steps: { actionType: string; delayMinutes: number; config: Prisma.InputJsonValue }[] = [];
    for (const [i, raw] of rawSteps.entries()) {
      const s = stepShape.safeParse(raw);
      if (!s.success || !isActionType(s.data.actionType)) return { error: `Step ${i + 1} is not a kind of step we know.` };
      const config = parseStepConfig(s.data.config);
      const problem = stepProblem(s.data.actionType, config);
      if (problem) return { error: `Step ${i + 1}: ${problem}` };
      steps.push({ actionType: s.data.actionType, delayMinutes: Math.round(s.data.delayMinutes), config: config as unknown as Prisma.InputJsonValue });
    }

    const filters = parseTriggerFilters({
      productIds: formData.getAll('productIds').map(String),
      batchIds: formData.getAll('batchIds').map(String),
      days: formData.get('days'),
      outcome: formData.get('outcome'),
    });

    const data = {
      name: d.name,
      description: d.description || null,
      triggerType: d.triggerType,
      triggerConfig: filters as unknown as Prisma.InputJsonValue,
      runOnce: d.runOnce === 'true',
    };

    let id = d.id;
    if (id) {
      const existing = await db.workflow.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true } });
      if (!existing) return { error: 'Automation not found.' };
      await db.$transaction([
        db.workflow.update({ where: { id }, data }),
        db.workflowStep.deleteMany({ where: { workflowId: id } }),
        db.workflowStep.createMany({ data: steps.map((s, i) => ({ workflowId: id!, sortOrder: i, ...s })) }),
      ]);
    } else {
      const created = await db.workflow.create({
        data: { organizationId: tenant.organizationId, ...data, isActive: false, steps: { create: steps.map((s, i) => ({ sortOrder: i, ...s })) } },
        select: { id: true },
      });
      id = created.id;
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: d.id ? 'workflow.updated' : 'workflow.created',
      entity: 'Workflow',
      entityId: id,
      after: { name: d.name, trigger: d.triggerType, steps: steps.map((s) => s.actionType) },
    });

    revalidatePath('/admin/workflows');
    revalidatePath(`/admin/workflows/${id}`);
    return { ok: true, id, message: d.id ? 'Saved.' : 'Saved. Switch it on when you are ready.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setWorkflowActive(id: string, active: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('edit');
    const wf = await db.workflow.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, name: true, _count: { select: { steps: true } } },
    });
    if (!wf) return { error: 'Automation not found.' };
    if (active && wf._count.steps === 0) return { error: 'Add a step before switching it on.' };

    await db.workflow.update({ where: { id }, data: { isActive: active } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: active ? 'workflow.on' : 'workflow.off', entity: 'Workflow', entityId: id, after: { name: wf.name } });

    revalidatePath('/admin/workflows');
    revalidatePath(`/admin/workflows/${id}`);
    return { ok: true, message: active ? 'On. It runs from the next matching event.' : 'Off. Runs already under way finish; no new ones start.' };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteWorkflow(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');
    const wf = await db.workflow.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true, name: true } });
    if (!wf) return { error: 'Automation not found.' };
    await db.workflow.delete({ where: { id } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'workflow.deleted', entity: 'Workflow', entityId: id, after: { name: wf.name } });
    revalidatePath('/admin/workflows');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Run it once, now, for one learner, as if the trigger had just fired for
 * them. A real run: messages are queued, tags are put on, points are
 * given. That is the point of a test; a pretend run proves nothing about
 * the template or the wallet.
 */
export async function testWorkflow(id: string, learnerId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('edit');
    const [wf, learner] = await Promise.all([
      db.workflow.findFirst({
        where: { id, organizationId: tenant.organizationId },
        select: { id: true, name: true, triggerType: true, steps: { orderBy: { sortOrder: 'asc' }, select: { delayMinutes: true } } },
      }),
      db.user.findFirst({ where: { id: learnerId, organizationId: tenant.organizationId }, select: { id: true, name: true } }),
    ]);
    if (!wf) return { error: 'Automation not found.' };
    if (!learner) return { error: 'Pick a learner.' };
    if (!wf.steps.length) return { error: 'Add a step first.' };

    const enrolment = await db.enrollment.findFirst({
      where: { userId: learner.id, organizationId: tenant.organizationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, productId: true, batchId: true, product: { select: { title: true } } },
    });

    const run = await db.workflowRun.create({
      data: {
        organizationId: tenant.organizationId,
        workflowId: wf.id,
        userId: learner.id,
        context: {
          event: wf.triggerType,
          test: true,
          testBy: user.name,
          subjectId: enrolment?.id ?? learner.id,
          productId: enrolment?.productId ?? null,
          batchId: enrolment?.batchId ?? null,
          item: enrolment?.product.title ?? 'your course',
          passed: true,
        } as Prisma.InputJsonValue,
        nextAt: new Date(),
        dedupeKey: `test:${wf.id}:${learner.id}:${Date.now()}`,
      },
      select: { id: true },
    });
    const outcome = await advanceRun(run.id);

    revalidatePath(`/admin/workflows/${id}`);
    return {
      ok: true,
      message:
        outcome === 'finished'
          ? `Ran every step for ${learner.name}. See the log below.`
          : outcome === 'waiting'
            ? `Started for ${learner.name}; the next step waits for its delay. See the log below.`
            : outcome === 'stopped'
              ? `Started for ${learner.name} and stopped at a condition. See the log below.`
              : `Started for ${learner.name} and a step failed. See the log below.`,
    };
  } catch (err) {
    return fail(err);
  }
}
