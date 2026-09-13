'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { orderForInvoice } from '@/lib/platform/billing';
import type { Cycle } from '@/lib/platform/billing-rules';
import type { ActionState } from '@/server/courses';

/** The academy's side of billing: what it is on, what it owes, what it wants next. */

async function guard() {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('settings.organization', 'edit')]);
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const m = err instanceof Error ? err.message : String(err);
  if (m === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (m === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[billing]', m);
  return { error: 'Something went wrong.' };
}

/** A plan change takes effect at the next renewal; nothing changes today. */
export async function requestPlanChange(planCode: string, cycle: Cycle): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const plan = await db.plan.findFirst({ where: { code: planCode, isActive: true, isPublic: true }, select: { id: true, name: true } });
    if (!plan) return { error: 'That plan is not available.' };
    const sub = await db.tenantSubscription.findUnique({ where: { tenantId: tenant.tenantId }, select: { id: true, planId: true, billingCycle: true } });
    if (!sub) return { error: 'No subscription to change.' };
    const same = sub.planId === plan.id && sub.billingCycle === cycle;
    await db.tenantSubscription.update({ where: { id: sub.id }, data: { nextPlanId: same ? null : plan.id, nextBillingCycle: same ? null : cycle, cancelAtPeriodEnd: false } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'billing.plan_change', entity: 'TenantSubscription', entityId: sub.id, after: { planCode, cycle } });
    revalidatePath('/admin/settings/billing');
    return { ok: true, message: same ? 'That is the plan you are on; nothing to change.' : `${plan.name}, ${cycle.toLowerCase()}, from the next renewal.` };
  } catch (err) {
    return fail(err);
  }
}

export async function setCancelAtPeriodEnd(cancel: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const changed = await db.tenantSubscription.updateMany({ where: { tenantId: tenant.tenantId }, data: { cancelAtPeriodEnd: cancel, nextPlanId: null, nextBillingCycle: null } });
    if (changed.count === 0) return { error: 'No subscription.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: cancel ? 'billing.cancel' : 'billing.keep', entity: 'TenantSubscription', entityId: tenant.tenantId });
    revalidatePath('/admin/settings/billing');
    return { ok: true, message: cancel ? 'The academy closes at the end of the paid period. Change your mind any time before then.' : 'Kept.' };
  } catch (err) {
    return fail(err);
  }
}

export type PayStart = { ok: true; gatewayOrderId: string; keyId: string; testMode: boolean; amountPaise: number; invoiceNo: string } | { ok: false; error: string };

export async function startInvoicePayment(invoiceId: string): Promise<PayStart> {
  try {
    const { tenant } = await guard();
    const invoice = await db.tenantInvoice.findFirst({ where: { id: invoiceId, tenantId: tenant.tenantId }, select: { id: true, invoiceNo: true, status: true } });
    if (!invoice) return { ok: false, error: 'Invoice not found.' };
    if (invoice.status === 'PAID') return { ok: false, error: 'Already paid.' };
    const order = await orderForInvoice(invoice.id);
    if (!order) return { ok: false, error: 'Online payment is not set up on the platform yet. Pay by transfer and the platform team will mark it paid.' };
    return { ok: true, ...order, invoiceNo: invoice.invoiceNo };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return { ok: false, error: m.startsWith('RAZORPAY') ? 'The payment gateway refused to start this payment.' : 'Could not start the payment.' };
  }
}
