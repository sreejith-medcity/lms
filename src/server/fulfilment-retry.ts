'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { fetchRazorpayPayment, paymentsConfigured } from '@/lib/razorpay';
import { fulfilPaidOrder } from '@/lib/fulfilment';
import type { ActionState } from '@/server/courses';

/**
 * Finishing an enrolment the gateway already took money for.
 *
 * A refusal is recorded rather than retried automatically, because whatever
 * caused it was usually still true a second later. Once it is fixed, this is
 * the button that completes the order, and it is the same code path the
 * webhook uses: the payment is looked up at Razorpay again rather than
 * trusted from our own record, the amount is checked against the order as
 * always, and fulfilment is idempotent, so pressing it twice grants one
 * enrolment.
 *
 * It is deliberately not a "grant access anyway" button. If Razorpay says the
 * payment was never captured, nothing is granted and it says so.
 */
export async function retryFulfilment(
  orderId: string,
  gatewayPaymentId: string,
): Promise<ActionState> {
  try {
    const [tenant, user] = await Promise.all([
      requireTenant(),
      requireStaff('sales.payments', 'edit'),
    ]);
    if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');

    if (!paymentsConfigured()) {
      return { error: 'The payment gateway is not configured on this site.' };
    }
    if (!gatewayPaymentId.trim()) {
      return { error: 'That refusal has no payment reference to check.' };
    }

    const order = await db.order.findFirst({
      where: { id: orderId, organizationId: tenant.organizationId },
      select: { id: true, orderNo: true, status: true },
    });
    if (!order) return { error: 'That order was not found.' };

    const payment = await fetchRazorpayPayment(gatewayPaymentId).catch(() => null);
    if (!payment) return { error: 'Razorpay could not be reached to confirm that payment.' };
    if (payment.status !== 'captured') {
      return {
        error: `Razorpay says that payment is ${payment.status}, not captured, so nothing was granted.`,
      };
    }

    const result = await fulfilPaidOrder({
      organizationId: tenant.organizationId,
      orderId: order.id,
      gatewayPaymentId: payment.id,
      amountPaise: payment.amount,
      method: payment.method ?? null,
      raw: payment,
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: result.ok ? 'payment.completed_by_hand' : 'payment.retry_failed',
      entity: 'Order',
      entityId: order.id,
      after: { gatewayPaymentId: payment.id, error: result.error ?? null },
    });

    revalidatePath('/admin/payments');

    if (!result.ok) return { error: `It failed again: ${result.error ?? 'unknown reason'}` };

    return {
      ok: true,
      message: result.alreadyDone
        ? `${order.orderNo} was already complete. Nothing changed.`
        : `${order.orderNo} is done: ${result.enrollmentIds.length} enrolment${
            result.enrollmentIds.length === 1 ? '' : 's'
          } granted${result.invoiceNo ? `, invoice ${result.invoiceNo}` : ''}.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
    if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
    console.error('[fulfilment retry]', message);
    return { error: 'That could not be completed. The reason is in the log.' };
  }
}
