'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { canMarkPaid, canVoid, codeProblem, normaliseCode, percentProblem } from '@/lib/affiliates';
import type { ActionState } from '@/server/courses';

/**
 * Affiliates from the office: adding a partner, editing their share,
 * pausing them, and settling what they are owed.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('marketing.campaigns', action)]);
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[affiliates]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function saveAffiliate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let created: string | null = null;
  try {
    const { tenant, user } = await guard();
    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim() || null;
    const phone = String(formData.get('phone') ?? '').trim() || null;
    const code = normaliseCode(String(formData.get('code') ?? ''));
    const commissionPercent = Number(formData.get('commissionPercent') ?? 10);
    const payoutDetails = String(formData.get('payoutDetails') ?? '').trim() || null;
    const notes = String(formData.get('notes') ?? '').trim() || null;
    const userEmail = String(formData.get('userEmail') ?? '').trim();

    if (name.length < 2) return { error: 'Give the partner a name.' };
    const codeIssue = codeProblem(code);
    if (codeIssue) return { error: codeIssue };
    const pctIssue = percentProblem(commissionPercent);
    if (pctIssue) return { error: pctIssue };

    const clash = await db.affiliate.findFirst({ where: { organizationId: tenant.organizationId, code, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
    if (clash) return { error: 'That code is taken by another partner.' };

    // The account they see their numbers with, matched by email, when they have one.
    let userId: string | null = null;
    if (userEmail) {
      const account = await db.user.findFirst({ where: { organizationId: tenant.organizationId, email: userEmail.toLowerCase(), deletedAt: null }, select: { id: true } });
      if (!account) return { error: 'No account has that email. Leave it blank, or create the account first.' };
      userId = account.id;
    }

    const data = { name, email, phone, code, commissionPercent, payoutDetails, notes, userId };
    if (id) {
      const changed = await db.affiliate.updateMany({ where: { id, organizationId: tenant.organizationId }, data });
      if (changed.count === 0) return { error: 'Partner not found.' };
      await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'affiliate.update', entity: 'Affiliate', entityId: id, after: { name, code, commissionPercent } });
      revalidatePath('/admin/affiliates');
      revalidatePath(`/admin/affiliates/${id}`);
      return { ok: true, message: 'Saved.' };
    }
    const row = await db.affiliate.create({ data: { organizationId: tenant.organizationId, createdById: user.id, ...data }, select: { id: true } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'affiliate.create', entity: 'Affiliate', entityId: row.id, after: { name, code, commissionPercent } });
    created = row.id;
  } catch (err) {
    return fail(err);
  }
  revalidatePath('/admin/affiliates');
  redirect(`/admin/affiliates/${created}`);
}

export async function setAffiliateStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const changed = await db.affiliate.updateMany({ where: { id, organizationId: tenant.organizationId }, data: { status } });
    if (changed.count === 0) return { error: 'Partner not found.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: status === 'PAUSED' ? 'affiliate.paused' : 'affiliate.resumed', entity: 'Affiliate', entityId: id });
    revalidatePath('/admin/affiliates');
    revalidatePath(`/admin/affiliates/${id}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** The office paid the partner: every approved sale they are owed is marked paid under one reference. */
export async function payAffiliate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const affiliateId = String(formData.get('affiliateId') ?? '');
    const payoutRef = String(formData.get('payoutRef') ?? '').trim().slice(0, 120);
    if (!payoutRef) return { error: 'Write the payment reference: the UPI or bank transaction id, or the cheque number.' };
    const owed = await db.affiliateSale.findMany({ where: { organizationId: tenant.organizationId, affiliateId, status: 'APPROVED' }, select: { id: true, commissionPaise: true, status: true } });
    const ids = owed.filter((s) => canMarkPaid(s.status)).map((s) => s.id);
    if (ids.length === 0) return { error: 'Nothing is owed right now.' };
    await db.affiliateSale.updateMany({ where: { id: { in: ids } }, data: { status: 'PAID', paidAt: new Date(), payoutRef } });
    const total = owed.reduce((n, s) => n + s.commissionPaise, 0);
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'affiliate.paid', entity: 'Affiliate', entityId: affiliateId, after: { sales: ids.length, paise: total, payoutRef } });
    revalidatePath(`/admin/affiliates/${affiliateId}`);
    revalidatePath('/admin/affiliates');
    return { ok: true, message: `${ids.length} sale${ids.length === 1 ? '' : 's'} marked paid.` };
  } catch (err) {
    return fail(err);
  }
}

/** A sale the office decides not to honour: a chargeback, a mistake, a partner buying for themselves. */
export async function voidSale(saleId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const sale = await db.affiliateSale.findFirst({ where: { id: saleId, organizationId: tenant.organizationId }, select: { id: true, status: true, affiliateId: true } });
    if (!sale) return { error: 'Sale not found.' };
    if (!canVoid(sale.status)) return { error: 'A sale already paid out cannot be voided here.' };
    await db.affiliateSale.update({ where: { id: sale.id }, data: { status: 'VOID' } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'affiliate.sale_voided', entity: 'AffiliateSale', entityId: sale.id });
    revalidatePath(`/admin/affiliates/${sale.affiliateId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
