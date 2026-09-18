'use server';

import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { getParentSession } from '@/lib/parent-session';
import { recordAudit } from '@/lib/audit';
import { maskContact } from '@/lib/parents';
import { beginInstalmentOrder, beginMiscFeeOrder, checkoutFailure, type CheckoutStart } from '@/lib/fee-checkout';
import { attributionJson, requestAttribution } from '@/lib/attribution-server';

/**
 * A parent paying a child's instalment or charge. The order is the
 * child's, built by the same code the learner's own button uses; the
 * parent's link is what lets them start it, and the audit trail says
 * which contact pressed Pay. Nothing here posts money: the gateway's
 * confirmation and the webhook do that, and until they do the screen
 * says Processing.
 */

async function parentFor(childId: string): Promise<{ organizationId: string; currency: string; contact: string } | null> {
  const tenant = await requireTenant();
  const session = await getParentSession();
  if (!session || session.organizationId !== tenant.organizationId) return null;
  const link = await db.parentLink.count({ where: { organizationId: tenant.organizationId, contact: session.contact, learnerId: childId, status: 'ACTIVE' } });
  if (link === 0) return null;
  return { organizationId: tenant.organizationId, currency: tenant.currency, contact: session.contact };
}

export async function parentPayInstalment(childId: string, instalmentId: string): Promise<CheckoutStart> {
  try {
    const p = await parentFor(childId);
    if (!p) return { ok: false, error: 'Please sign in again.' };
    const res = await beginInstalmentOrder({ organizationId: p.organizationId, currency: p.currency, userId: childId, attribution: attributionJson(await requestAttribution()) }, instalmentId);
    if (res.ok) await recordAudit({ organizationId: p.organizationId, actorId: null, action: 'parent.payment_started', entity: 'Order', entityId: res.orderId, after: { childId, instalmentId, by: maskContact(p.contact) } });
    return res;
  } catch (err) {
    return checkoutFailure(err, 'parent-pay');
  }
}

export async function parentPayMiscFee(childId: string, feeId: string): Promise<CheckoutStart> {
  try {
    const p = await parentFor(childId);
    if (!p) return { ok: false, error: 'Please sign in again.' };
    const res = await beginMiscFeeOrder({ organizationId: p.organizationId, currency: p.currency, userId: childId, attribution: attributionJson(await requestAttribution()) }, feeId);
    if (res.ok) await recordAudit({ organizationId: p.organizationId, actorId: null, action: 'parent.payment_started', entity: 'Order', entityId: res.orderId, after: { childId, feeId, by: maskContact(p.contact) } });
    return res;
  } catch (err) {
    return checkoutFailure(err, 'parent-pay');
  }
}
