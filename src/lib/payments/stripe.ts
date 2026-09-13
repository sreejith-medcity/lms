import { GatewayError, type Gateway } from '@/lib/payments/gateway';
import { stripeForm, stripeOutcome, stripeSignatureValid } from '@/lib/payments/signatures';

/**
 * Stripe Checkout, for learners paying from outside India with an
 * international card. A hosted session, a redirect back, and the session
 * fetched from Stripe before anything is granted. The webhook
 * (checkout.session.completed) does the same job when the browser never
 * comes back.
 */
export function stripe(creds: { secretKey: string; webhookSecret?: string }): Gateway {
  const api = 'https://api.stripe.com/v1';
  const headers = { Authorization: `Bearer ${creds.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' };

  async function call(path: string, form?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${api}${path}`, { method: form ? 'POST' : 'GET', headers, body: form ? stripeForm(form) : undefined, cache: 'no-store' });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !json) {
      const err = json?.error as { message?: string } | undefined;
      throw new GatewayError('stripe', err?.message ?? `HTTP ${res.status}`);
    }
    return json;
  }

  const confirmationOf = (session: Record<string, unknown>) => {
    const intent = session.payment_intent;
    const paymentId = typeof intent === 'string' ? intent : typeof intent === 'object' && intent ? String((intent as { id?: string }).id ?? '') : '';
    return {
      outcome: stripeOutcome(typeof session.payment_status === 'string' ? session.payment_status : undefined, typeof session.status === 'string' ? session.status : undefined),
      gatewayPaymentId: paymentId || String(session.id ?? ''),
      amountPaise: typeof session.amount_total === 'number' ? session.amount_total : 0,
      method: 'card',
      feePaise: null,
      reason: null,
      raw: session,
    };
  };

  return {
    id: 'stripe',
    name: 'Stripe',

    async start(input) {
      const session = await call('/checkout/sessions', {
        mode: 'payment',
        client_reference_id: input.orderId,
        customer_email: input.buyer.email ?? undefined,
        success_url: `${input.returnUrl}${input.returnUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${input.returnUrl}${input.returnUrl.includes('?') ? '&' : '?'}cancelled=1`,
        line_items: [{ quantity: 1, price_data: { currency: input.currency.toLowerCase(), unit_amount: input.amountPaise, product_data: { name: input.description.slice(0, 120) } } }],
        metadata: { orderId: input.orderId, orderNo: input.orderNo, organizationId: input.organizationId },
      });
      const url = typeof session.url === 'string' ? session.url : null;
      const id = typeof session.id === 'string' ? session.id : null;
      if (!url || !id) throw new GatewayError('stripe', 'no checkout URL returned');
      return { kind: 'redirect', gatewayOrderId: id, url };
    },

    async confirm({ gatewayOrderId, params }) {
      const id = params.session_id || gatewayOrderId;
      if (!id) throw new GatewayError('stripe', 'no session to check');
      const session = await call(`/checkout/sessions/${encodeURIComponent(id)}`);
      return confirmationOf(session);
    },

    async webhook(rawBody, headers) {
      if (!creds.webhookSecret) return { ok: false, reason: 'no webhook secret on the card' };
      if (!stripeSignatureValid(rawBody, headers.get('stripe-signature'), creds.webhookSecret)) return { ok: false, reason: 'bad signature' };
      type StripeEvent = { type?: string; data?: { object?: Record<string, unknown> } };
      let event: StripeEvent | null = null;
      try {
        event = JSON.parse(rawBody) as StripeEvent;
      } catch {
        return { ok: false, reason: 'malformed body' };
      }
      if (event?.type !== 'checkout.session.completed' && event?.type !== 'checkout.session.async_payment_succeeded') return { ok: true, event: null };
      const session = event.data?.object;
      if (!session) return { ok: true, event: null };
      const metadata = (session.metadata ?? {}) as { orderNo?: string };
      return {
        ok: true,
        event: { orderNo: metadata.orderNo ?? null, gatewayOrderId: typeof session.id === 'string' ? session.id : null, confirmation: confirmationOf(session) },
      };
    },
  };
}
