'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { parseShares, templateProblem } from '@/lib/pricing-templates';
import type { ActionState } from '@/server/courses';

/**
 * Pricing templates from the office. A template is a shape, not a price:
 * "three parts of 40/30/30, a month apart, access for a year". Applied
 * when a plan is added, and copied rather than linked, so a change here
 * never moves a price under somebody already on it.
 */

const PAGE = '/admin/pricing-templates';

async function guard(action: 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('courses.pricing_and_publish', action)]);
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[pricing-templates]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function savePricingTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const planType = String(formData.get('planType') ?? 'INSTALMENT');
    const instalmentCount = Math.round(Number(formData.get('instalmentCount') ?? 3)) || 0;
    const gapDays = Math.round(Number(formData.get('gapDays') ?? 30)) || 0;
    const shares = planType === 'INSTALMENT' ? parseShares(String(formData.get('shares') ?? '')) : [];
    const validityRaw = Number(formData.get('validityDays') ?? 0);
    const validityDays = validityRaw > 0 ? Math.round(validityRaw) : null;
    const invoiceAnchor = String(formData.get('invoiceAnchor') ?? 'CLASS_COMMENCEMENT') === 'ENROLLMENT' ? 'ENROLLMENT' : 'CLASS_COMMENCEMENT';
    const notes = String(formData.get('notes') ?? '').trim() || null;

    const problem = templateProblem({ name, planType, instalmentCount, gapDays, shares });
    if (problem) return { error: problem };

    const data = {
      name,
      planType: planType as 'ONE_TIME' | 'INSTALMENT' | 'SUBSCRIPTION',
      instalmentCount: planType === 'INSTALMENT' ? instalmentCount : 1,
      gapDays: planType === 'INSTALMENT' ? gapDays : 30,
      shares,
      validityDays,
      invoiceAnchor,
      notes,
    };

    if (id) {
      const changed = await db.pricingTemplate.updateMany({ where: { id, organizationId: tenant.organizationId }, data });
      if (changed.count === 0) return { error: 'Template not found.' };
    } else {
      const count = await db.pricingTemplate.count({ where: { organizationId: tenant.organizationId } });
      await db.pricingTemplate.create({ data: { organizationId: tenant.organizationId, sortOrder: count, ...data } });
    }
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: id ? 'pricing_template.update' : 'pricing_template.create', entity: 'PricingTemplate', entityId: id || name, after: { name, planType, instalmentCount, gapDays, shares } });
    revalidatePath(PAGE);
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setPricingTemplateActive(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const changed = await db.pricingTemplate.updateMany({ where: { id, organizationId: tenant.organizationId }, data: { isActive } });
    if (changed.count === 0) return { error: 'Template not found.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: isActive ? 'pricing_template.enable' : 'pricing_template.disable', entity: 'PricingTemplate', entityId: id });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Removed outright only while no plan was made from it; otherwise it is retired. */
export async function deletePricingTemplate(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');
    const row = await db.pricingTemplate.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true, _count: { select: { plans: true } } } });
    if (!row) return { error: 'Template not found.' };
    if (row._count.plans > 0) {
      await db.pricingTemplate.update({ where: { id: row.id }, data: { isActive: false } });
      await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'pricing_template.disable', entity: 'PricingTemplate', entityId: id });
      revalidatePath(PAGE);
      return { ok: true, message: `Retired: ${row._count.plans} plan${row._count.plans === 1 ? ' was' : 's were'} made from it, so it stays on the record.` };
    }
    await db.pricingTemplate.delete({ where: { id: row.id } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'pricing_template.delete', entity: 'PricingTemplate', entityId: id });
    revalidatePath(PAGE);
    return { ok: true, message: 'Removed.' };
  } catch (err) {
    return fail(err);
  }
}
