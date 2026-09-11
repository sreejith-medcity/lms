'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getSessionUser, requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { queueNotifications } from '@/lib/notify';
import { formatMoney } from '@/lib/money';
import { priceOrder } from '@/lib/order-lines';
import { createRazorpayOrder, paymentsConfigured } from '@/lib/razorpay';
import { allocatePayment, balanceOf, daysOverdue, nextReceiptNumber, receiptPrefix } from '@/lib/dues';
import type { ActionState } from '@/server/courses';

/**
 * Collecting fees.
 *
 * Two doors into the same ledger. At the counter, a branch takes whatever the
 * learner has in hand and it is settled oldest due first, which may leave a
 * part on the last instalment it reaches; that is one payment row with a
 * receipt number, and the split is written on it. Online, a learner pays one
 * instalment at a time through an ordinary order, and fulfilment settles it
 * when the gateway confirms.
 *
 * Either way the instalment's running figure moves and the collections report
 * moves with it. Nothing here moves money in a gateway.
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
  console.error('[fees]', message);
  return { error: 'Something went wrong. Please try again.' };
}

function isDuplicate(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
}

const METHODS = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'] as const;

/** The gateway column is a coarse family; the method is what was actually used. */
function gatewayFor(method: (typeof METHODS)[number]): string {
  if (method === 'CASH') return 'CASH';
  if (method === 'CHEQUE') return 'CHEQUE';
  if (method === 'BANK') return 'BANK';
  return 'MANUAL';
}

const counter = z.object({
  enrollmentId: z.string().min(1),
  amountRupees: z.coerce.number().positive('Enter the amount received'),
  method: z.enum(METHODS),
  reference: z.string().trim().max(80).optional().or(z.literal('')),
  note: z.string().trim().max(300).optional().or(z.literal('')),
  paidOn: z.string().optional().or(z.literal('')),
});

export interface ReceiptState extends ActionState {
  receiptNo?: string;
}

/**
 * Records money taken at the counter and settles it against the schedule.
 *
 * Refuses more than is owed rather than keeping a credit nobody tracks: the
 * cashier is told the balance and asked to take that.
 */
export async function recordFeePayment(_prev: ReceiptState, formData: FormData): Promise<ReceiptState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking');

    const parsed = counter.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const paise = Math.round(d.amountRupees * 100);

    const enrollment = await db.enrollment.findFirst({
      where: { id: d.enrollmentId, organizationId: tenant.organizationId },
      select: {
        id: true,
        userId: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
        product: { select: { title: true } },
        instalments: {
          select: { id: true, sequence: true, amountPaise: true, paidPaise: true, dueDate: true, paidAt: true },
        },
      },
    });
    if (!enrollment) return { error: 'Enrolment not found.' };
    if (!enrollment.instalments.length) return { error: 'This enrolment has no fee plan to pay against.' };

    const owed = enrollment.instalments.reduce((n, i) => n + balanceOf(i), 0);
    if (owed <= 0) return { error: 'Nothing is owed on this plan.' };

    const split = allocatePayment(enrollment.instalments, paise);
    if (split.unallocatedPaise > 0) {
      return {
        error: `That is more than what is owed. The balance is ${formatMoney(owed, tenant.currency)}.`,
      };
    }

    const paidOn = d.paidOn ? new Date(d.paidOn) : new Date();
    if (Number.isNaN(paidOn.getTime())) return { error: 'That date is not valid.' };

    const prefix = receiptPrefix(paidOn.getFullYear());

    // Numbered from the highest issued, and retried once on a collision:
    // two counters saving in the same second both read the same last number.
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
              userId: enrollment.userId,
              receiptNo,
              gateway: gatewayFor(d.method),
              gatewayRef: d.reference || null,
              method: d.method.toLowerCase(),
              amountPaise: paise,
              currency: tenant.currency,
              status: 'CAPTURED',
              capturedAt: paidOn,
              raw: {
                kind: 'fee',
                enrollmentId: enrollment.id,
                item: enrollment.product.title,
                recordedBy: user.id,
                note: d.note || null,
                allocations: split.allocations.map((a) => ({ ...a })),
              } as unknown as Prisma.InputJsonValue,
            },
            select: { id: true },
          });

          for (const a of split.allocations) {
            const row = enrollment.instalments.find((i) => i.id === a.instalmentId)!;
            await tx.instalment.update({
              where: { id: a.instalmentId },
              data: {
                paidPaise: row.paidPaise + a.paise,
                ...(a.settles ? { paidAt: paidOn, paymentId: payment.id } : {}),
              },
            });
          }

          return payment.id;
        });
        break;
      } catch (err) {
        if (!isDuplicate(err) || attempt === 2) throw err;
      }
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'fee.payment.recorded',
      entity: 'Payment',
      entityId: paymentId,
      after: {
        learner: enrollment.user.name,
        amountPaise: paise,
        method: d.method,
        receiptNo,
        instalments: split.allocations.map((a) => a.sequence),
      },
    });

    // The learner's copy. Queued, so a branch with no SMS wallet loses
    // nothing but the message.
    await queueNotifications({
      organizationId: tenant.organizationId,
      eventKey: 'payment.received',
      recipients: [{ userId: enrollment.user.id, email: enrollment.user.email, phone: enrollment.user.phone }],
      dedupeKey: `payment.received:receipt:${receiptNo}`,
      context: {
        name: enrollment.user.name,
        amount: formatMoney(paise, tenant.currency),
        item: enrollment.product.title,
        organization: tenant.name,
        receiptUrl: `/learn/receipts/${receiptNo}`,
      },
    }).catch((err: unknown) => console.error('[fees] receipt message not queued', err));

    revalidatePath('/admin/fees');
    revalidatePath(`/admin/fees/${enrollment.id}`);

    const left = owed - paise;
    return {
      ok: true,
      receiptNo,
      message: left > 0
        ? `Receipt ${receiptNo} issued. ${formatMoney(left, tenant.currency)} still to come.`
        : `Receipt ${receiptNo} issued. The plan is fully paid.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * A nudge sent now, by a person, outside the schedule. Keyed on the moment
 * so it goes however many times the office decides to send it.
 */
export async function sendFeeReminder(enrollmentId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('sales.fee_tracking');

    const enrollment = await db.enrollment.findFirst({
      where: { id: enrollmentId, organizationId: tenant.organizationId },
      select: {
        id: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
        product: { select: { title: true } },
        instalments: {
          where: { paidAt: null },
          orderBy: { dueDate: 'asc' },
          select: { id: true, sequence: true, amountPaise: true, paidPaise: true, dueDate: true },
        },
      },
    });
    if (!enrollment) return { error: 'Enrolment not found.' };
    const next = enrollment.instalments.find((i) => balanceOf(i) > 0);
    if (!next) return { error: 'Nothing is owed on this plan.' };

    const result = await queueNotifications({
      organizationId: tenant.organizationId,
      eventKey: 'instalment.due',
      recipients: [{ userId: enrollment.user.id, email: enrollment.user.email, phone: enrollment.user.phone }],
      dedupeKey: `instalment:${next.id}:manual:${Date.now()}`,
      context: {
        name: enrollment.user.name,
        amount: formatMoney(balanceOf(next), tenant.currency),
        item: enrollment.product.title,
        date: next.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        stage: daysOverdue(next.dueDate, new Date()) >= 1 ? 'overdue' : 'due',
        payUrl: '/learn/fees',
        organization: tenant.name,
      },
    });

    await db.instalment.update({ where: { id: next.id }, data: { reminderSentAt: new Date() } });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'fee.reminder.sent',
      entity: 'Instalment',
      entityId: next.id,
      after: { learner: enrollment.user.name, queued: result.queued },
    });

    revalidatePath(`/admin/fees/${enrollment.id}`);
    return result.queued > 0
      ? { ok: true, message: 'Reminder queued. It goes out with the next send.' }
      : { error: 'No channel is switched on for fee reminders, or the learner has no contact details.' };
  } catch (err) {
    return fail(err);
  }
}

/* Paying online ------------------------------------------------------------- */

export type InstalmentCheckoutStart = { ok: true; orderId: string } | { ok: false; error: string };

/**
 * A learner paying one instalment from their fees page. It is an ordinary
 * order with one line, marked with the instalment it is for, so fulfilment
 * settles the instalment rather than enrolling them again. Always the
 * oldest open one: paying a later part while an earlier one is open would
 * leave the ageing wrong and the office confused.
 */
export async function startInstalmentCheckout(instalmentId: string): Promise<InstalmentCheckoutStart> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Please sign in to continue.' };
    if (!paymentsConfigured()) {
      return { ok: false, error: 'Online payment is not switched on yet. Please pay at the academy.' };
    }

    const instalment = await db.instalment.findFirst({
      where: {
        id: instalmentId,
        paidAt: null,
        enrollment: { organizationId: tenant.organizationId, userId: user.id },
      },
      select: {
        id: true,
        sequence: true,
        amountPaise: true,
        paidPaise: true,
        enrollment: {
          select: {
            id: true,
            branchId: true,
            productId: true,
            pricingPlanId: true,
            product: { select: { title: true } },
            instalments: {
              where: { paidAt: null },
              orderBy: { dueDate: 'asc' },
              select: { id: true, amountPaise: true, paidPaise: true },
              take: 1,
            },
            _count: { select: { instalments: true } },
          },
        },
      },
    });
    if (!instalment) return { ok: false, error: 'That instalment is not open.' };

    const oldest = instalment.enrollment.instalments.find((i) => balanceOf(i) > 0);
    if (oldest && oldest.id !== instalment.id) {
      return { ok: false, error: 'Please pay the earlier instalment first.' };
    }

    const balance = balanceOf(instalment);
    if (balance <= 0) return { ok: false, error: 'That instalment is already paid.' };

    // An order already waiting for this instalment is reused rather than
    // doubled: a learner who closed the payment window and came back should
    // land on the same one.
    const pending = await db.order.findFirst({
      where: {
        organizationId: tenant.organizationId,
        userId: user.id,
        status: 'PENDING',
        gatewayOrderId: { not: null },
        items: { some: { instalmentId: instalment.id } },
      },
      select: { id: true, totalPaise: true },
    });
    if (pending && pending.totalPaise > 0) return { ok: true, orderId: pending.id };

    const taxConfig = await db.taxConfig.findFirst({ where: { organizationId: tenant.organizationId } });

    const priced = priceOrder({
      lines: [
        {
          productId: instalment.enrollment.productId,
          pricingPlanId: instalment.enrollment.pricingPlanId,
          title: `${instalment.enrollment.product.title} (instalment ${instalment.sequence} of ${instalment.enrollment._count.instalments})`,
          pricePaise: balance,
          isPrimary: true,
        },
      ],
      discountPaise: 0,
      tax: {
        cgstPercent: taxConfig?.cgstPercent ?? 9,
        sgstPercent: taxConfig?.sgstPercent ?? 9,
        igstPercent: taxConfig?.igstPercent ?? 18,
        interState: false,
        pricesAreExclusive: taxConfig?.pricesAreExclusive ?? true,
        enabled: taxConfig?.enabled ?? true,
      },
    });

    const count = await db.order.count({ where: { organizationId: tenant.organizationId } });
    const orderNo = `ORD-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    const order = await db.order.create({
      data: {
        organizationId: tenant.organizationId,
        branchId: instalment.enrollment.branchId,
        userId: user.id,
        orderNo,
        status: 'PENDING',
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
            instalmentId: instalment.id,
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

    const gatewayOrder = await createRazorpayOrder({
      amountPaise: order.totalPaise,
      currency: order.currency,
      receipt: order.orderNo,
      notes: { orderId: order.id, organizationId: tenant.organizationId, instalmentId: instalment.id },
    });

    await db.order.update({ where: { id: order.id }, data: { gatewayOrderId: gatewayOrder.id } });

    return { ok: true, orderId: order.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[fees] checkout', message);
    if (message.startsWith('RAZORPAY:')) {
      return { ok: false, error: 'The payment gateway refused to start this payment. Please try again.' };
    }
    return { ok: false, error: 'We could not start the payment just now. Please try again.' };
  }
}
