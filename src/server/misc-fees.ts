'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getSessionUser, requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { queueNotifications } from '@/lib/notify';
import { formatMoney } from '@/lib/money';
import { priceOrder } from '@/lib/order-lines';
import { paymentsAvailable, prepareOrder } from '@/lib/payments';
import { nextReceiptNumber, receiptPrefix } from '@/lib/dues';
import { closeProblem, feeProblem, feeTypeProblem } from '@/lib/misc-fees';
import { attributionJson, requestAttribution } from '@/lib/attribution-server';
import type { ActionState } from '@/server/courses';
import type { InstalmentCheckoutStart, ReceiptState } from '@/server/fees';

/**
 * Miscellaneous fees: the charges beyond the course fee.
 *
 * The office keeps a catalogue of them (an exam fee and its usual amount),
 * raises one against a learner's enrolment, and either takes the money at
 * the counter or waits for the learner to pay it online from their fees
 * page. Waiving keeps the row and the reason; nothing paid is ever deleted.
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
  console.error('[misc-fees]', message);
  return { error: 'Something went wrong. Please try again.' };
}

function isDuplicate(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
}

/* The catalogue ------------------------------------------------------------ */

export async function saveFeeType(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking');
    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const amountPaise = Math.round(Number(formData.get('amountRupees') ?? 0) * 100);
    const taxable = formData.get('taxable') === 'on';
    const description = String(formData.get('description') ?? '').trim() || null;
    const problem = feeTypeProblem({ name, amountPaise });
    if (problem) return { error: problem };

    const data = { name, amountPaise, taxable, description };
    if (id) {
      const changed = await db.feeType.updateMany({ where: { id, organizationId: tenant.organizationId }, data });
      if (changed.count === 0) return { error: 'Fee type not found.' };
    } else {
      const count = await db.feeType.count({ where: { organizationId: tenant.organizationId } });
      await db.feeType.create({ data: { organizationId: tenant.organizationId, sortOrder: count, ...data } });
    }
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: id ? 'fee_type.update' : 'fee_type.create', entity: 'FeeType', entityId: id || name, after: data });
    revalidatePath('/admin/fees/types');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setFeeTypeActive(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking');
    const changed = await db.feeType.updateMany({ where: { id, organizationId: tenant.organizationId }, data: { isActive } });
    if (changed.count === 0) return { error: 'Fee type not found.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: isActive ? 'fee_type.enable' : 'fee_type.disable', entity: 'FeeType', entityId: id });
    revalidatePath('/admin/fees/types');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Raising and closing ------------------------------------------------------ */

export async function raiseMiscFee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking');
    const enrollmentId = String(formData.get('enrollmentId') ?? '');
    const feeTypeId = String(formData.get('feeTypeId') ?? '');
    const labelIn = String(formData.get('label') ?? '').trim();
    const amountPaise = Math.round(Number(formData.get('amountRupees') ?? 0) * 100);
    const dueRaw = String(formData.get('dueDate') ?? '');
    const note = String(formData.get('note') ?? '').trim() || null;
    const tell = formData.get('tell') === 'on';

    const enrollment = await db.enrollment.findFirst({
      where: { id: enrollmentId, organizationId: tenant.organizationId },
      select: { id: true, userId: true, user: { select: { id: true, name: true, email: true, phone: true } }, product: { select: { title: true } } },
    });
    if (!enrollment) return { error: 'Enrolment not found.' };

    const feeType = feeTypeId
      ? await db.feeType.findFirst({ where: { id: feeTypeId, organizationId: tenant.organizationId }, select: { id: true, name: true, taxable: true } })
      : null;
    if (feeTypeId && !feeType) return { error: 'That fee type does not exist.' };

    const label = labelIn || feeType?.name || '';
    const problem = feeProblem({ label, amountPaise });
    if (problem) return { error: problem };

    const dueDate = dueRaw ? new Date(`${dueRaw}T00:00:00`) : null;
    if (dueDate && Number.isNaN(dueDate.getTime())) return { error: 'That date is not valid.' };

    const fee = await db.miscFee.create({
      data: {
        organizationId: tenant.organizationId,
        userId: enrollment.userId,
        enrollmentId: enrollment.id,
        feeTypeId: feeType?.id ?? null,
        label,
        amountPaise,
        taxable: feeType?.taxable ?? true,
        dueDate,
        note,
        createdById: user.id,
      },
      select: { id: true },
    });

    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'misc_fee.raise', entity: 'MiscFee', entityId: fee.id, after: { learner: enrollment.user.name, label, amountPaise } });

    if (tell) {
      await queueNotifications({
        organizationId: tenant.organizationId,
        eventKey: 'misc_fee.raised',
        recipients: [{ userId: enrollment.user.id, email: enrollment.user.email, phone: enrollment.user.phone }],
        dedupeKey: `misc_fee.raised:${fee.id}`,
        context: {
          name: enrollment.user.name,
          item: label,
          course: enrollment.product.title,
          amount: formatMoney(amountPaise, tenant.currency),
          due: dueDate ? dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'when convenient',
          organization: tenant.name,
          url: '/learn/fees',
        },
      }).catch((err: unknown) => console.error('[misc-fees] notice not queued', err));
    }

    revalidatePath(`/admin/fees/${enrollment.id}`);
    revalidatePath('/admin/fees');
    return { ok: true, message: `${label} raised for ${formatMoney(amountPaise, tenant.currency)}.` };
  } catch (err) {
    return fail(err);
  }
}

async function openFee(id: string, organizationId: string) {
  const fee = await db.miscFee.findFirst({
    where: { id, organizationId },
    select: { id: true, label: true, amountPaise: true, status: true, enrollmentId: true, userId: true, user: { select: { id: true, name: true, email: true, phone: true } } },
  });
  if (!fee) return { fee: null, error: 'Fee not found.' };
  const problem = closeProblem(fee);
  return { fee, error: problem };
}

export async function waiveMiscFee(id: string, reason: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking');
    const { fee, error } = await openFee(id, tenant.organizationId);
    if (!fee || error) return { error: error ?? 'Fee not found.' };
    const why = reason.trim();
    if (why.length < 3) return { error: 'Say why it is waived; it stays on the record.' };
    await db.miscFee.update({ where: { id: fee.id }, data: { status: 'WAIVED', waivedReason: why } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'misc_fee.waive', entity: 'MiscFee', entityId: fee.id, after: { reason: why } });
    revalidatePath(`/admin/fees/${fee.enrollmentId}`);
    return { ok: true, message: 'Waived.' };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelMiscFee(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking', 'delete');
    const { fee, error } = await openFee(id, tenant.organizationId);
    if (!fee || error) return { error: error ?? 'Fee not found.' };
    await db.miscFee.update({ where: { id: fee.id }, data: { status: 'CANCELLED' } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'misc_fee.cancel', entity: 'MiscFee', entityId: fee.id });
    revalidatePath(`/admin/fees/${fee.enrollmentId}`);
    return { ok: true, message: 'Cancelled.' };
  } catch (err) {
    return fail(err);
  }
}

const METHODS = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'] as const;
type Method = (typeof METHODS)[number];

function gatewayFor(method: Method): string {
  if (method === 'CASH') return 'CASH';
  if (method === 'CHEQUE') return 'CHEQUE';
  if (method === 'BANK') return 'BANK';
  return 'MANUAL';
}

/** Money for one fee taken at the counter: one payment row, one receipt, the fee marked paid. */
export async function recordMiscFeePayment(_prev: ReceiptState, formData: FormData): Promise<ReceiptState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking');
    const id = String(formData.get('feeId') ?? '');
    const methodRaw = String(formData.get('method') ?? 'CASH');
    const method: Method = (METHODS as readonly string[]).includes(methodRaw) ? (methodRaw as Method) : 'CASH';
    const reference = String(formData.get('reference') ?? '').trim() || null;
    const paidOnRaw = String(formData.get('paidOn') ?? '');
    const paidOn = paidOnRaw ? new Date(paidOnRaw) : new Date();
    if (Number.isNaN(paidOn.getTime())) return { error: 'That date is not valid.' };

    const { fee, error } = await openFee(id, tenant.organizationId);
    if (!fee || error) return { error: error ?? 'Fee not found.' };

    const prefix = receiptPrefix(paidOn.getFullYear());
    let receiptNo = '';
    let paymentId = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latest = await db.payment.findFirst({
        where: { organizationId: tenant.organizationId, receiptNo: { startsWith: prefix } },
        orderBy: { receiptNo: 'desc' },
        select: { receiptNo: true },
      });
      receiptNo = nextReceiptNumber(latest?.receiptNo ?? null, prefix);
      try {
        paymentId = await db.$transaction(async (tx) => {
          const payment = await tx.payment.create({
            data: {
              organizationId: tenant.organizationId,
              userId: fee.userId,
              receiptNo,
              gateway: gatewayFor(method),
              gatewayRef: reference,
              method: method.toLowerCase(),
              amountPaise: fee.amountPaise,
              currency: tenant.currency,
              status: 'CAPTURED',
              capturedAt: paidOn,
              raw: { kind: 'misc_fee', miscFeeId: fee.id, enrollmentId: fee.enrollmentId, item: fee.label, recordedBy: user.id } as unknown as Prisma.InputJsonValue,
            },
            select: { id: true },
          });
          await tx.miscFee.update({ where: { id: fee.id }, data: { status: 'PAID', paidAt: paidOn, paymentId: payment.id } });
          return payment.id;
        });
        break;
      } catch (err) {
        if (!isDuplicate(err) || attempt === 2) throw err;
      }
    }

    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'misc_fee.payment.recorded', entity: 'Payment', entityId: paymentId, after: { learner: fee.user.name, label: fee.label, amountPaise: fee.amountPaise, method, receiptNo } });

    await queueNotifications({
      organizationId: tenant.organizationId,
      eventKey: 'payment.received',
      recipients: [{ userId: fee.user.id, email: fee.user.email, phone: fee.user.phone }],
      dedupeKey: `payment.received:receipt:${receiptNo}`,
      context: {
        name: fee.user.name,
        amount: formatMoney(fee.amountPaise, tenant.currency),
        item: fee.label,
        organization: tenant.name,
        receiptUrl: `/learn/receipts/${receiptNo}`,
        attachReceipt: receiptNo,
      },
    }).catch((err: unknown) => console.error('[misc-fees] receipt message not queued', err));

    revalidatePath(`/admin/fees/${fee.enrollmentId}`);
    return { ok: true, receiptNo, message: `Receipt ${receiptNo} issued for ${fee.label}.` };
  } catch (err) {
    return fail(err);
  }
}

/* Paying online ------------------------------------------------------------- */

/**
 * A learner paying one of their charges from the fees page: an ordinary
 * order with one line marked with the fee, so fulfilment marks the fee paid
 * rather than enrolling anybody. Tax follows the fee type: study material
 * may carry GST, an exam fee passed through to a board may not.
 */
export async function startMiscFeeCheckout(feeId: string): Promise<InstalmentCheckoutStart> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Please sign in to continue.' };
    if (!(await paymentsAvailable(tenant.organizationId))) {
      return { ok: false, error: 'Online payment is not switched on yet. Please pay at the academy.' };
    }

    const fee = await db.miscFee.findFirst({
      where: { id: feeId, organizationId: tenant.organizationId, userId: user.id, status: 'PENDING' },
      select: {
        id: true,
        label: true,
        amountPaise: true,
        taxable: true,
        enrollment: { select: { branchId: true, productId: true, pricingPlanId: true, product: { select: { title: true } } } },
      },
    });
    if (!fee) return { ok: false, error: 'That charge is not open.' };

    const pending = await db.order.findFirst({
      where: { organizationId: tenant.organizationId, userId: user.id, status: 'PENDING', gatewayOrderId: { not: null }, items: { some: { miscFeeId: fee.id } } },
      select: { id: true, totalPaise: true },
    });
    if (pending && pending.totalPaise > 0) return { ok: true, orderId: pending.id };

    const taxConfig = await db.taxConfig.findFirst({ where: { organizationId: tenant.organizationId } });
    const priced = priceOrder({
      lines: [{ productId: fee.enrollment.productId, pricingPlanId: fee.enrollment.pricingPlanId, title: `${fee.label} (${fee.enrollment.product.title})`, pricePaise: fee.amountPaise, isPrimary: true }],
      discountPaise: 0,
      tax: {
        cgstPercent: taxConfig?.cgstPercent ?? 9,
        sgstPercent: taxConfig?.sgstPercent ?? 9,
        igstPercent: taxConfig?.igstPercent ?? 18,
        interState: false,
        pricesAreExclusive: taxConfig?.pricesAreExclusive ?? true,
        enabled: fee.taxable && (taxConfig?.enabled ?? true),
      },
    });

    const count = await db.order.count({ where: { organizationId: tenant.organizationId } });
    const orderNo = `ORD-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;
    const order = await db.order.create({
      data: {
        organizationId: tenant.organizationId,
        branchId: fee.enrollment.branchId,
        userId: user.id,
        orderNo,
        status: 'PENDING',
        attribution: attributionJson(await requestAttribution()),
        currency: tenant.currency,
        subtotalPaise: priced.subtotalPaise,
        discountPaise: 0,
        taxPaise: priced.taxPaise,
        walletPaise: 0,
        totalPaise: priced.beforePointsPaise,
        items: {
          create: priced.lines.map((l) => ({
            productId: l.productId,
            pricingPlanId: l.pricingPlanId,
            miscFeeId: fee.id,
            titleSnapshot: l.title,
            pricePaise: l.pricePaise,
            discountPaise: l.discountPaise,
            taxPaise: l.taxPaise,
            totalPaise: l.totalPaise,
          })),
        },
      },
      select: { id: true, orderNo: true, currency: true, totalPaise: true },
    });

    await prepareOrder(tenant.organizationId, order, { miscFeeId: fee.id });
    return { ok: true, orderId: order.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[misc-fees] checkout', message);
    return { ok: false, error: 'We could not start the payment just now. Please try again.' };
  }
}
