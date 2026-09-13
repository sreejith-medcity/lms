import type { GatewayOutcome } from '@/lib/payments/signatures';

/**
 * A payment gateway, from the order's point of view: start a payment for
 * an order, tell us what happened when the buyer comes back, and tell us
 * what happened when the gateway calls in on its own.
 *
 * Razorpay keeps its own routes (a modal, not a redirect); the three here
 * all send the buyer away and bring them back.
 */

export type GatewayId = 'razorpay' | 'phonepe' | 'payu' | 'stripe';

export interface StartInput {
  orderId: string;
  orderNo: string;
  amountPaise: number;
  currency: string;
  description: string;
  buyer: { name: string; email: string | null; phone: string | null };
  /** Where the buyer lands afterwards, and where the gateway calls in. */
  returnUrl: string;
  notifyUrl: string;
  organizationId: string;
}

export type StartResult =
  /** Send the browser here. */
  | { kind: 'redirect'; gatewayOrderId: string; url: string }
  /** POST this form from the browser (PayU wants a form, not a link). */
  | { kind: 'form'; gatewayOrderId: string; action: string; fields: Record<string, string> };

export interface Confirmation {
  outcome: GatewayOutcome;
  /** The gateway's id for the payment, or the order id when it has no separate one yet. */
  gatewayPaymentId: string;
  amountPaise: number;
  method: string | null;
  feePaise: number | null;
  reason?: string | null;
  raw: unknown;
}

export interface WebhookEvent {
  orderNo: string | null;
  gatewayOrderId: string | null;
  confirmation: Confirmation;
}

export interface Gateway {
  id: GatewayId;
  name: string;
  start(input: StartInput): Promise<StartResult>;
  /**
   * The buyer is back. `params` is whatever came on the URL or in the posted
   * form; the adapter checks the signature where there is one and then asks
   * the gateway what really happened, never trusting the browser alone.
   */
  confirm(input: { orderNo: string; gatewayOrderId: string | null; amountPaise: number; params: Record<string, string> }): Promise<Confirmation>;
  /** A call from the gateway itself. Returns null when the body is not for us or fails its check. */
  webhook(rawBody: string, headers: Headers): Promise<{ ok: true; event: WebhookEvent | null } | { ok: false; reason: string }>;
}

export class GatewayError extends Error {
  constructor(
    public gateway: GatewayId,
    message: string,
  ) {
    super(`${gateway}: ${message}`);
  }
}
