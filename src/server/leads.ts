'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import type { Prisma } from '@prisma/client';
import type { ActionState } from '@/server/courses';

/**
 * The enquiry pipeline.
 *
 * Deliberately small. A full CRM is a different product, and Medcity may well
 * keep one; what an LMS owes is the bit only it can do, which is knowing that
 * this enquiry became that enrolment. Everything here is built around that link.
 */

export const STAGES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_BOOKED',
  'NEGOTIATION',
  'WON',
  'LOST',
  'SUPPORT',
] as const;

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('leads_and_enquiries.manage_leads', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to manage enquiries.' };
  console.error('[leads]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function setLeadStage(
  leadId: string,
  stage: (typeof STAGES)[number],
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const lead = await db.lead.findFirst({
      where: { id: leadId, organizationId: tenant.organizationId },
      select: { id: true, stage: true, name: true },
    });
    if (!lead) return { error: 'Enquiry not found.' };
    if (lead.stage === stage) return { ok: true };

    await db.$transaction([
      db.lead.update({ where: { id: leadId }, data: { stage } }),
      db.leadActivity.create({
        data: {
          leadId,
          type: 'STAGE_CHANGE',
          payload: { from: lead.stage, to: stage, by: user.id } as Prisma.InputJsonValue,
        },
      }),
    ]);

    revalidatePath('/admin/leads');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function claimLead(leadId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    await db.lead.updateMany({
      where: { id: leadId, organizationId: tenant.organizationId },
      data: { ownerId: user.id },
    });

    revalidatePath('/admin/leads');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const note = z.object({
  leadId: z.string().min(1),
  type: z.enum(['NOTE', 'CALL', 'EMAIL', 'WHATSAPP']),
  body: z.string().trim().min(1, 'Write something').max(2000),
  followUpAt: z.string().optional().or(z.literal('')),
});

export async function addLeadNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const parsed = note.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const lead = await db.lead.findFirst({
      where: { id: d.leadId, organizationId: tenant.organizationId },
      select: { id: true, stage: true },
    });
    if (!lead) return { error: 'Enquiry not found.' };

    await db.leadActivity.create({
      data: {
        leadId: d.leadId,
        type: d.type,
        payload: { body: d.body, by: user.id } as Prisma.InputJsonValue,
      },
    });

    if (d.followUpAt) {
      await db.followUp.create({
        data: {
          leadId: d.leadId,
          dueAt: new Date(d.followUpAt),
          channel: d.type === 'NOTE' ? 'CALL' : d.type,
          note: d.body.slice(0, 200),
          ownerId: user.id,
        },
      });
    }

    // Logging a contact moves a new enquiry along on its own. Nobody should have
    // to remember to change a dropdown after they have already done the work.
    if (lead.stage === 'NEW' && d.type !== 'NOTE') {
      await db.lead.update({ where: { id: d.leadId }, data: { stage: 'CONTACTED' } });
    }

    revalidatePath('/admin/leads');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function completeFollowUp(followUpId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    await db.followUp.updateMany({
      where: { id: followUpId, lead: { organizationId: tenant.organizationId } },
      data: { status: 'DONE', completedAt: new Date() },
    });

    revalidatePath('/admin/leads');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Marks an enquiry as won and points it at the learner it became.
 *
 * This is the whole reason the pipeline lives here rather than in a CRM: an
 * enquiry that turns into an enrolment can say which one, so "where do our
 * learners actually come from" has an answer that is not a guess.
 */
export async function linkLeadToLearner(leadId: string, userId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const [lead, learner] = await Promise.all([
      db.lead.findFirst({
        where: { id: leadId, organizationId: tenant.organizationId },
        select: { id: true, name: true },
      }),
      db.user.findFirst({
        where: { id: userId, organizationId: tenant.organizationId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);
    if (!lead || !learner) return { error: 'Not found.' };

    await db.$transaction([
      db.lead.update({
        where: { id: leadId },
        data: { stage: 'WON', convertedUserId: userId },
      }),
      db.leadActivity.create({
        data: {
          leadId,
          type: 'STAGE_CHANGE',
          payload: { to: 'WON', convertedTo: learner.name, by: user.id } as Prisma.InputJsonValue,
        },
      }),
    ]);

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'lead.converted',
      entity: 'Lead',
      entityId: leadId,
      after: { learner: learner.name },
    });

    revalidatePath('/admin/leads');
    return { ok: true, message: `${lead.name} is linked to ${learner.name}.` };
  } catch (err) {
    return fail(err);
  }
}
