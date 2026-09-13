import { db } from '@/lib/db';
import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { settingText } from '@/lib/settings/store';
import { createRazorpayOrder, razorpayConfig } from '@/lib/razorpay';
import { fulfilPaidOrder, recordFailedPayment } from '@/lib/fulfilment';
import { phonepe } from '@/lib/payments/phonepe';
import { payu } from '@/lib/payments/payu';
import { stripe } from '@/lib/payments/stripe';
import type { Confirmation, Gateway, GatewayId, StartResult } from '@/lib/payments/gateway';

/**
 * Which gateways an academy has, and the three moments an order meets one:
 * being prepared for checkout, being started (the buyer sent away), and
 * being settled (the buyer back, or the gateway calling in).
 */

export const GATEWAY_LABEL: Record<GatewayId, string> = { razorpay: 'Razorpay', phonepe: 'PhonePe', payu: 'PayU', stripe: 'Stripe' };

/** The gateway's own name for itself in the payments table. */
export function gatewayRef(id: GatewayId): string {
  return id.toUpperCase();
}

export async function gatewayFor(organizationId: string, id: GatewayId): Promise<Gateway | null> {
  if (id === 'razorpay') return null; // Razorpay keeps its own routes.
  const resolved = await resolveIntegration(organizationId, id);
  if (!resolved?.complete) return null;
  const v = resolved.values;
  if (id === 'phonepe') return phonepe({ merchantId: v.merchantId, saltKey: v.saltKey, saltIndex: v.saltIndex, environment: v.environment });
  if (id === 'payu') return payu({ merchantKey: v.merchantKey, salt: v.salt, environment: v.environment });
  if (id === 'stripe') return stripe({ secretKey: v.secretKey, webhookSecret: v.webhookSecret });
  return null;
}

export interface GatewayChoice {
  /** The gateway Indian buyers are sent to, when one is connected. */
  primary: GatewayId | null;
  /** Stripe, offered alongside for cards from abroad, when connected. */
  international: 'stripe' | null;
}

export async function gatewayChoice(organizationId: string): Promise<GatewayChoice> {
  const [wanted, abroad] = await Promise.all([settingText(organizationId, 'payments.gateway'), settingText(organizationId, 'payments.international')]);
  const primaryWanted = (wanted.trim() || 'razorpay') as GatewayId;
  let primary: GatewayId | null = null;
  if (primaryWanted === 'razorpay') primary = razorpayConfig() ? 'razorpay' : null;
  else if (primaryWanted === 'phonepe' || primaryWanted === 'payu') primary = (await gatewayFor(organizationId, primaryWanted)) ? primaryWanted : null;
  // Razorpay as the fallback when the chosen one has no keys yet.
  if (!primary && razorpayConfig()) primary = 'razorpay';
  const international = abroad.trim() === 'stripe' && (await gatewayFor(organizationId, 'stripe')) ? 'stripe' : null;
  return { primary, international };
}

/** Any way to take money online at all. */
export async function paymentsAvailable(organizationId: string): Promise<boolean> {
  const c = await gatewayChoice(organizationId);
  return Boolean(c.primary || c.international);
}

/**
 * Right after an order is written: Razorpay wants its order created now so
 * the modal can open; the redirect gateways are started when the buyer
 * presses the button. Either way the order remembers its gateway.
 */
export async function prepareOrder(organizationId: string, order: { id: string; orderNo: string; totalPaise: number; currency: string }, notes: Record<string, string> = {}): Promise<void> {
  const choice = await gatewayChoice(organizationId);
  const primary = choice.primary ?? (choice.international ? 'stripe' : null);
  if (!primary) return;
  if (primary === 'razorpay') {
    const gatewayOrder = await createRazorpayOrder({ amountPaise: order.totalPaise, currency: order.currency, receipt: order.orderNo, notes: { orderId: order.id, organizationId, ...notes } });
    await db.order.update({ where: { id: order.id }, data: { gateway: 'razorpay', gatewayOrderId: gatewayOrder.id } });
    return;
  }
  await db.order.update({ where: { id: order.id }, data: { gateway: primary } });
}

/** The buyer pressed the button: start the payment with this gateway and remember it on the order. */
export async function startWith(input: {
  organizationId: string;
  gatewayId: Exclude<GatewayId, 'razorpay'>;
  order: { id: string; orderNo: string; totalPaise: number; currency: string; items: { titleSnapshot: string }[] };
  buyer: { name: string; email: string | null; phone: string | null };
  origin: string;
}): Promise<StartResult> {
  const gateway = await gatewayFor(input.organizationId, input.gatewayId);
  if (!gateway) throw new Error('GATEWAY_NOT_CONNECTED');
  const description = input.order.items.map((i) => i.titleSnapshot).join(', ').slice(0, 120) || 'Course enrolment';
  const result = await gateway.start({
    orderId: input.order.id,
    orderNo: input.order.orderNo,
    amountPaise: input.order.totalPaise,
    currency: input.order.currency,
    description,
    buyer: input.buyer,
    returnUrl: `${input.origin}/api/payments/${gateway.id}/return?orderId=${encodeURIComponent(input.order.id)}`,
    notifyUrl: `${input.origin}/api/payments/${gateway.id}/webhook`,
    organizationId: input.organizationId,
  });
  await db.order.update({ where: { id: input.order.id }, data: { gateway: gateway.id, gatewayOrderId: result.gatewayOrderId } });
  await recordIntegrationEvent({ organizationId: input.organizationId, provider: gateway.id, direction: 'OUT', action: `Started payment for ${input.order.orderNo}`, ok: true });
  return result;
}

/**
 * What the gateway said, written into the ledger: a paid order is
 * fulfilled (enrolments, invoice, receipt), a failed attempt recorded, a
 * pending one left alone until the gateway says more.
 */
export async function settle(input: { organizationId: string; gatewayId: GatewayId; orderId: string; userId: string | null; confirmation: Confirmation }): Promise<'PAID' | 'PENDING' | 'FAILED'> {
  const c = input.confirmation;
  const ref = gatewayRef(input.gatewayId);
  if (c.outcome === 'PAID') {
    const result = await fulfilPaidOrder({
      organizationId: input.organizationId,
      orderId: input.orderId,
      gatewayPaymentId: c.gatewayPaymentId,
      amountPaise: c.amountPaise,
      feePaise: c.feePaise,
      method: c.method,
      raw: c.raw,
      gateway: ref,
    });
    if (!result.ok) {
      await recordIntegrationEvent({ organizationId: input.organizationId, provider: input.gatewayId, direction: 'IN', action: 'Payment refused at fulfilment', ok: false, detail: result.error ?? null });
      return 'FAILED';
    }
    return 'PAID';
  }
  if (c.outcome === 'FAILED') {
    await recordFailedPayment({
      organizationId: input.organizationId,
      orderId: input.orderId,
      userId: input.userId,
      gatewayPaymentId: c.gatewayPaymentId,
      amountPaise: c.amountPaise,
      reason: c.reason ?? null,
      raw: c.raw,
      gateway: ref,
    });
    return 'FAILED';
  }
  return 'PENDING';
}
