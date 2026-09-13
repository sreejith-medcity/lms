'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePlatform } from '@/lib/platform/session';
import { provisionTenant } from '@/lib/platform/provision';
import { issueInvoice, runPlatformBilling, settleInvoice } from '@/lib/platform/billing';
import { cycleAmount, periodEnd, type Cycle } from '@/lib/platform/billing-rules';
import { signupProblem } from '@/lib/platform/signup';
import type { ActionState } from '@/server/courses';

/** The console's hands on an academy: standing, plan, domains, invoices. */

function fail(err: unknown): ActionState {
  const m = err instanceof Error ? err.message : String(err);
  if (m === 'PLATFORM_SIGN_IN') return { error: 'Please sign in again.' };
  if (m === 'FORBIDDEN') return { error: 'Your console role cannot do that.' };
  console.error('[platform]', m);
  return { error: 'Something went wrong.' };
}

const paths = (id: string) => {
  revalidatePath('/platform');
  revalidatePath('/platform/tenants');
  revalidatePath(`/platform/tenants/${id}`);
};

export async function createTenantByHand(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requirePlatform(true);
    const input = {
      academyName: String(formData.get('academyName') ?? ''),
      slug: String(formData.get('slug') ?? '').trim().toLowerCase(),
      ownerName: String(formData.get('ownerName') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      password: String(formData.get('password') ?? ''),
      planCode: String(formData.get('planCode') ?? ''),
    };
    const problem = signupProblem(input);
    if (problem) return { error: problem };
    if (await db.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } })) return { error: 'That address is taken.' };
    const made = await provisionTenant({ ...input, ownerEmail: input.email, ownerPhone: input.phone, status: formData.get('active') === 'on' ? 'ACTIVE' : 'TRIALING' });
    revalidatePath('/platform/tenants');
    return { ok: true, message: `Ready at ${made.hostname}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function setTenantStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED', reason?: string): Promise<ActionState> {
  try {
    await requirePlatform(true);
    const now = new Date();
    await db.tenant.update({
      where: { id },
      data:
        status === 'SUSPENDED'
          ? { status, suspendedAt: now, suspendReason: reason?.trim() || 'Paused by the platform' }
          : status === 'CANCELLED'
            ? { status, churnedAt: now }
            : { status, suspendedAt: null, suspendReason: null, churnedAt: null },
    });
    if (status === 'SUSPENDED') await db.tenantSubscription.updateMany({ where: { tenantId: id }, data: { status: 'PAUSED' } });
    if (status === 'CANCELLED') await db.tenantSubscription.updateMany({ where: { tenantId: id }, data: { status: 'CANCELLED', cancelledAt: now } });
    if (status === 'ACTIVE') await db.tenantSubscription.updateMany({ where: { tenantId: id, status: { in: ['PAUSED', 'PAST_DUE', 'CANCELLED'] } }, data: { status: 'ACTIVE', cancelledAt: null } });
    paths(id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function extendTrial(id: string, days: number): Promise<ActionState> {
  try {
    await requirePlatform(true);
    const n = Math.max(1, Math.min(90, Math.round(days)));
    const sub = await db.tenantSubscription.findUnique({ where: { tenantId: id }, select: { id: true, currentPeriodEnd: true } });
    if (!sub) return { error: 'No subscription.' };
    const end = new Date(Math.max(sub.currentPeriodEnd.getTime(), Date.now()) + n * 864e5);
    await db.tenantSubscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: end, status: 'TRIALING' } });
    await db.tenant.update({ where: { id }, data: { status: 'TRIALING', trialEndsAt: end } });
    paths(id);
    return { ok: true, message: `Trial now ends ${end.toDateString()}.` };
  } catch (err) {
    return fail(err);
  }
}

/** A plan change from the console applies now, with a fresh period and an invoice for it. */
export async function changePlanNow(id: string, planId: string, cycle: Cycle): Promise<ActionState> {
  try {
    await requirePlatform(true);
    const [plan, sub] = await Promise.all([
      db.plan.findUnique({ where: { id: planId }, select: { id: true, monthlyPaise: true, quarterlyPaise: true, annualPaise: true } }),
      db.tenantSubscription.findUnique({ where: { tenantId: id }, select: { id: true } }),
    ]);
    if (!plan || !sub) return { error: 'Plan or subscription not found.' };
    const now = new Date();
    const end = periodEnd(now, cycle);
    await db.tenantSubscription.update({ where: { id: sub.id }, data: { planId, billingCycle: cycle, amountPaise: cycleAmount(plan, cycle), status: 'ACTIVE', currentPeriodStart: now, currentPeriodEnd: end, nextPlanId: null, nextBillingCycle: null } });
    await issueInvoice({ tenantId: id, planId, cycle, periodStart: now, periodEnd: end, now });
    await db.tenant.update({ where: { id }, data: { status: 'ACTIVE', trialEndsAt: null } });
    paths(id);
    return { ok: true, message: 'Plan changed and the period invoiced.' };
  } catch (err) {
    return fail(err);
  }
}

export async function addTenantDomain(id: string, hostnameRaw: string): Promise<ActionState> {
  try {
    await requirePlatform(true);
    const hostname = hostnameRaw.trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hostname)) return { error: 'That is not a hostname.' };
    const taken = await db.tenantDomain.findUnique({ where: { hostname }, select: { tenantId: true } });
    if (taken && taken.tenantId !== id) return { error: 'That hostname belongs to another academy.' };
    await db.tenantDomain.upsert({ where: { hostname }, create: { tenantId: id, hostname, isCustom: true, sslStatus: 'PENDING' }, update: {} });
    paths(id);
    return { ok: true, message: `${hostname} added. Point its DNS at the platform and mark it verified once SSL is issued.` };
  } catch (err) {
    return fail(err);
  }
}

export async function setDomainState(id: string, hostname: string, state: 'ISSUED' | 'PENDING' | 'PRIMARY' | 'REMOVE'): Promise<ActionState> {
  try {
    await requirePlatform(true);
    const row = await db.tenantDomain.findFirst({ where: { hostname, tenantId: id }, select: { id: true } });
    if (!row) return { error: 'Domain not found.' };
    if (state === 'REMOVE') await db.tenantDomain.delete({ where: { id: row.id } });
    else if (state === 'PRIMARY') {
      await db.tenantDomain.updateMany({ where: { tenantId: id }, data: { isPrimary: false } });
      await db.tenantDomain.update({ where: { id: row.id }, data: { isPrimary: true } });
    } else await db.tenantDomain.update({ where: { id: row.id }, data: { sslStatus: state, verifiedAt: state === 'ISSUED' ? new Date() : null } });
    paths(id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function markTenantInvoicePaid(invoiceId: string, reference: string): Promise<ActionState> {
  try {
    await requirePlatform(true);
    const inv = await db.tenantInvoice.findUnique({ where: { id: invoiceId }, select: { tenantId: true, status: true } });
    if (!inv) return { error: 'Invoice not found.' };
    if (inv.status === 'PAID') return { error: 'Already paid.' };
    await settleInvoice(invoiceId, { reference: reference.trim() || 'By hand' });
    paths(inv.tenantId);
    return { ok: true, message: 'Marked paid.' };
  } catch (err) {
    return fail(err);
  }
}

export async function voidTenantInvoice(invoiceId: string): Promise<ActionState> {
  try {
    await requirePlatform(true);
    const inv = await db.tenantInvoice.findUnique({ where: { id: invoiceId }, select: { tenantId: true, status: true } });
    if (!inv) return { error: 'Invoice not found.' };
    if (inv.status === 'PAID') return { error: 'A paid invoice cannot be voided.' };
    await db.tenantInvoice.update({ where: { id: invoiceId }, data: { status: 'VOID' } });
    paths(inv.tenantId);
    return { ok: true, message: 'Voided.' };
  } catch (err) {
    return fail(err);
  }
}

export async function runBillingNow(): Promise<ActionState> {
  try {
    await requirePlatform(true);
    const out = await runPlatformBilling();
    revalidatePath('/platform');
    revalidatePath('/platform/tenants');
    const summary = Object.entries(out).filter(([, v]) => v !== 'none').map(([k, v]) => `${k}: ${v}`);
    return { ok: true, message: summary.length ? summary.join('; ') : 'Nothing was due.' };
  } catch (err) {
    return fail(err);
  }
}

export async function savePlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requirePlatform(true);
    const id = String(formData.get('id') ?? '');
    const code = String(formData.get('code') ?? '').trim().toLowerCase();
    const name = String(formData.get('name') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim() || null;
    const monthlyPaise = Math.round(Number(formData.get('monthly') ?? 0) * 100);
    const quarterly = Number(formData.get('quarterly') ?? 0);
    const annual = Number(formData.get('annual') ?? 0);
    const trialDays = Math.max(0, Math.min(90, Math.round(Number(formData.get('trialDays') ?? 14))));
    const isPublic = formData.get('isPublic') === 'on';
    const isActive = formData.get('isActive') === 'on';
    if (!/^[a-z0-9-]{2,30}$/.test(code)) return { error: 'A code of letters, digits and hyphens.' };
    if (name.length < 2) return { error: 'Give the plan a name.' };
    if (monthlyPaise < 0) return { error: 'The monthly price cannot be negative.' };
    const data = { code, name, description, monthlyPaise, quarterlyPaise: quarterly > 0 ? Math.round(quarterly * 100) : null, annualPaise: annual > 0 ? Math.round(annual * 100) : null, trialDays, isPublic, isActive };
    const plan = id ? await db.plan.update({ where: { id }, data, select: { id: true } }) : await db.plan.create({ data: { ...data, sortOrder: await db.plan.count() }, select: { id: true } });

    // Limits: one row per metric present in the form.
    for (const metric of ['ACTIVE_LEARNERS', 'STAFF_SEATS', 'BRANCHES', 'COURSES', 'STORAGE_BYTES'] as const) {
      const included = Number(formData.get(`included_${metric}`) ?? NaN);
      if (!Number.isFinite(included)) continue;
      const hardCapRaw = Number(formData.get(`cap_${metric}`) ?? 0);
      const overage = Math.round(Number(formData.get(`overage_${metric}`) ?? 0) * 100);
      const scale = metric === 'STORAGE_BYTES' ? 1024 ** 3 : 1;
      await db.planLimit.upsert({
        where: { planId_metric: { planId: plan.id, metric } },
        create: { planId: plan.id, metric, included: BigInt(Math.round(included * scale)), hardCap: hardCapRaw > 0 ? BigInt(Math.round(hardCapRaw * scale)) : null, overagePaisePerUnit: overage },
        update: { included: BigInt(Math.round(included * scale)), hardCap: hardCapRaw > 0 ? BigInt(Math.round(hardCapRaw * scale)) : null, overagePaisePerUnit: overage },
      });
    }
    for (const feature of ['events', 'memberships', 'mentorships', 'community', 'ai_companion', 'white_label', 'sso', 'api', 'scorm']) {
      await db.planFeature.upsert({
        where: { planId_feature: { planId: plan.id, feature } },
        create: { planId: plan.id, feature, enabled: formData.get(`feature_${feature}`) === 'on' },
        update: { enabled: formData.get(`feature_${feature}`) === 'on' },
      });
    }
    revalidatePath('/platform/plans');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}
