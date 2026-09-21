'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { queueNotifications } from '@/lib/notify';
import { formatMoney } from '@/lib/money';
import { nextReceiptNumber, receiptPrefix } from '@/lib/dues';
import { closePass } from '@/lib/passes';
import { readMemberCode } from '@/lib/member-card';
import { canSeeBatch, canSeeLearner, staffScope } from '@/lib/scope';
import type { ActionState } from '@/server/courses';

/**
 * Selling and keeping prepaid passes.
 *
 * A plan is what the counter sells (ten classes, ninety days, so much); a
 * pass is one sold to one learner, paid there and then, with a receipt.
 * Selling one puts the learner on a batch of the plan's course, since a
 * pass with no class to attend is a receipt for nothing.
 */

async function guard(permission: string, action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[passes]', message);
  return { error: 'Something went wrong. Please try again.' };
}

function isDuplicate(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
}

const planShape = z.object({
  id: z.string().optional().or(z.literal('')),
  name: z.string().trim().min(2, 'Give the pass a name').max(80),
  classes: z.coerce.number().int().min(1, 'At least one class').max(500),
  validityDays: z.coerce.number().int().min(1).max(3650).optional().or(z.literal('')),
  priceRupees: z.coerce.number().min(0, 'The price cannot be negative'),
  productId: z.string().optional().or(z.literal('')),
  isActive: z.string().optional(),
});

export async function savePassPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking');
    const parsed = planShape.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.productId) {
      const product = await db.product.findFirst({ where: { id: d.productId, organizationId: tenant.organizationId, type: 'COURSE', deletedAt: null }, select: { id: true } });
      if (!product) return { error: 'That course is not here.' };
    }
    const data = {
      name: d.name,
      classes: d.classes,
      validityDays: d.validityDays ? Number(d.validityDays) : null,
      pricePaise: Math.round(d.priceRupees * 100),
      productId: d.productId || null,
      isActive: d.isActive !== 'off',
    };
    let id = d.id || '';
    if (id) {
      const have = await db.passPlan.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true } });
      if (!have) return { error: 'Plan not found.' };
      await db.passPlan.update({ where: { id }, data });
    } else {
      id = (await db.passPlan.create({ data: { organizationId: tenant.organizationId, ...data }, select: { id: true } })).id;
    }
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: d.id ? 'pass.plan.updated' : 'pass.plan.created', entity: 'PassPlan', entityId: id, after: data });
    revalidatePath('/admin/passes');
    return { ok: true, message: d.id ? 'Plan saved.' : 'Plan added. It can be sold from the form below.' };
  } catch (err) {
    return fail(err);
  }
}

export async function togglePassPlan(id: string, on: boolean): Promise<ActionState> {
  try {
    const { tenant } = await guard('sales.fee_tracking');
    const r = await db.passPlan.updateMany({ where: { id, organizationId: tenant.organizationId }, data: { isActive: on } });
    if (r.count === 0) return { error: 'Plan not found.' };
    revalidatePath('/admin/passes');
    return { ok: true, message: on ? 'On sale again.' : 'Taken off sale. Passes already sold carry on.' };
  } catch (err) {
    return fail(err);
  }
}

const METHODS = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'] as const;

function gatewayFor(method: (typeof METHODS)[number]): string {
  if (method === 'CASH') return 'CASH';
  if (method === 'CHEQUE') return 'CHEQUE';
  if (method === 'BANK') return 'BANK';
  return 'MANUAL';
}

const saleShape = z.object({
  learner: z.string().trim().min(1, 'Who is buying it: scan the card, or type the registration number, email or mobile'),
  planId: z.string().min(1, 'Pick a pass'),
  batchId: z.string().min(1, 'Pick the batch they will attend'),
  amountRupees: z.coerce.number().min(0, 'Enter the amount received'),
  method: z.enum(METHODS),
  reference: z.string().trim().max(80).optional().or(z.literal('')),
  note: z.string().trim().max(300).optional().or(z.literal('')),
});

export interface SaleState extends ActionState {
  receiptNo?: string;
  passId?: string;
}

/** Who "the learner" on the sale form is: a scanned card, a registration number, an email or a mobile. */
async function findLearner(organizationId: string, raw: string) {
  const read = readMemberCode(raw);
  const text = raw.trim().toLowerCase();
  const where = read?.kind === 'user' ? { id: read.userId } : read?.kind === 'registration' ? { registrationNo: read.registrationNo } : text.includes('@') ? { email: text } : { phone: raw.replace(/[\s()-]/g, '').replace(/^\+?91(?=\d{10}$)/, '') };
  return db.user.findFirst({ where: { ...where, organizationId, kind: 'LEARNER', deletedAt: null }, select: { id: true, name: true, email: true, phone: true, branchMemberships: { where: { isPrimary: true }, select: { branchId: true }, take: 1 } } });
}

export async function sellPass(_prev: SaleState, formData: FormData): Promise<SaleState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking');
    const parsed = saleShape.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const [learner, plan, batch] = await Promise.all([
      findLearner(tenant.organizationId, d.learner),
      db.passPlan.findFirst({ where: { id: d.planId, organizationId: tenant.organizationId, isActive: true }, select: { id: true, name: true, classes: true, validityDays: true, pricePaise: true, productId: true } }),
      db.batch.findFirst({ where: { id: d.batchId, organizationId: tenant.organizationId, deletedAt: null }, select: { id: true, name: true, branchId: true, status: true, course: { select: { productId: true, product: { select: { title: true } } } } } }),
    ]);
    if (!learner) return { error: 'No learner matches that. Scan their card, or type the registration number, email or mobile on their account.' };
    if (!plan) return { error: 'That pass is not on sale.' };
    if (!batch) return { error: 'Batch not found.' };
    if (batch.status === 'COMPLETED' || batch.status === 'ARCHIVED') return { error: 'That batch has finished.' };
    if (plan.productId && plan.productId !== batch.course.productId) return { error: `${plan.name} is for another course; pick one of its batches.` };
    const scope = await staffScope(user);
    if (!(await canSeeLearner(scope, tenant.organizationId, learner.id))) return { error: 'That learner is outside your branch.' };
    if (!canSeeBatch(scope, batch)) return { error: 'That batch is outside your branch.' };

    const paise = Math.round(d.amountRupees * 100);
    const now = new Date();
    const expiresAt = plan.validityDays ? new Date(now.getTime() + plan.validityDays * 864e5) : null;
    const branchId = batch.branchId || learner.branchMemberships[0]?.branchId;
    const prefix = receiptPrefix(now.getFullYear());

    let receiptNo = '';
    let passId = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latest = await db.payment.findFirst({ where: { organizationId: tenant.organizationId, receiptNo: { startsWith: prefix } }, orderBy: { receiptNo: 'desc' }, select: { receiptNo: true } });
      receiptNo = nextReceiptNumber(latest?.receiptNo ?? null, prefix);
      try {
        passId = await db.$transaction(async (tx) => {
          // The place on the batch: the one they have, or a new one that ends with the pass.
          const existing = await tx.enrollment.findFirst({ where: { organizationId: tenant.organizationId, userId: learner.id, productId: batch.course.productId, batchId: batch.id }, select: { id: true, status: true } });
          const revive = existing?.status === 'EXPIRED' || existing?.status === 'CANCELLED';
          const enrolmentId = existing
            ? (await tx.enrollment.update({ where: { id: existing.id }, data: revive ? { status: 'ENROLLED', expiresAt, lastActivityAt: now } : { lastActivityAt: now }, select: { id: true } })).id
            : (
                await tx.enrollment.create({
                  data: { organizationId: tenant.organizationId, branchId, userId: learner.id, productId: batch.course.productId, batchId: batch.id, status: 'ENROLLED', source: 'ADMIN_SINGLE', startsAt: now, expiresAt },
                  select: { id: true },
                })
              ).id;
          const payment =
            paise > 0
              ? await tx.payment.create({
                  data: {
                    organizationId: tenant.organizationId,
                    userId: learner.id,
                    receiptNo,
                    gateway: gatewayFor(d.method),
                    gatewayRef: d.reference || null,
                    method: d.method.toLowerCase(),
                    amountPaise: paise,
                    currency: tenant.currency,
                    status: 'CAPTURED',
                    capturedAt: now,
                    raw: { kind: 'pass', plan: plan.name, classes: plan.classes, batch: batch.name, recordedBy: user.id, note: d.note || null } as unknown as Prisma.InputJsonValue,
                  },
                  select: { id: true },
                })
              : null;
          const pass = await tx.prepaidPass.create({
            data: { organizationId: tenant.organizationId, userId: learner.id, planId: plan.id, enrollmentId: enrolmentId, classesTotal: plan.classes, expiresAt, paymentId: payment?.id ?? null, note: d.note || null, issuedById: user.id },
            select: { id: true },
          });
          return pass.id;
        });
        break;
      } catch (err) {
        if (!isDuplicate(err) || attempt === 2) throw err;
        const target = String((err as { meta?: { target?: unknown } }).meta?.target ?? '');
        if (target.includes('gatewayRef')) return { error: 'That reference is already on a receipt here. Check the number, or leave it blank.' };
      }
    }

    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'pass.sold', entity: 'PrepaidPass', entityId: passId, after: { learner: learner.name, plan: plan.name, classes: plan.classes, batch: batch.name, amountPaise: paise, method: d.method, receiptNo: paise > 0 ? receiptNo : null } });
    if (paise > 0) {
      await queueNotifications({
        organizationId: tenant.organizationId,
        eventKey: 'payment.received',
        recipients: [{ userId: learner.id, email: learner.email, phone: learner.phone }],
        dedupeKey: `payment.received:receipt:${receiptNo}`,
        context: { name: learner.name, amount: formatMoney(paise, tenant.currency), item: `${plan.name} (${plan.classes} classes)`, organization: tenant.name, receiptUrl: `/learn/receipts/${receiptNo}`, attachReceipt: receiptNo },
      }).catch((err: unknown) => console.error('[passes] receipt message not queued', err));
    }
    revalidatePath('/admin/passes');
    revalidatePath(`/admin/batches/${batch.id}`);
    return {
      ok: true,
      receiptNo: paise > 0 ? receiptNo : undefined,
      passId,
      message: `${learner.name} has ${plan.classes} classes on ${batch.name}${expiresAt ? ` until ${expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.${paise > 0 ? ` Receipt ${receiptNo} issued.` : ' Nothing was charged.'}`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelPass(passId: string, reason: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking', 'delete');
    const pass = await db.prepaidPass.findFirst({ where: { id: passId, organizationId: tenant.organizationId }, select: { id: true, status: true, user: { select: { name: true } } } });
    if (!pass) return { error: 'Pass not found.' };
    if (pass.status !== 'ACTIVE') return { error: 'That pass is already closed.' };
    if (!reason.trim()) return { error: 'Say why, for the record.' };
    await closePass(tenant.organizationId, pass.id, 'CANCELLED');
    await db.prepaidPass.update({ where: { id: pass.id }, data: { note: reason.trim().slice(0, 300) } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'pass.cancelled', entity: 'PrepaidPass', entityId: pass.id, after: { learner: pass.user.name, reason: reason.trim() } });
    revalidatePath('/admin/passes');
    return { ok: true, message: 'Cancelled. Any refund is recorded from the payment itself.' };
  } catch (err) {
    return fail(err);
  }
}
