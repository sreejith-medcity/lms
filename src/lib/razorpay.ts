import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Razorpay over plain REST. No SDK: the whole surface we need is three calls and
 * two HMACs, and the install cost of the package is real on shared hosting.
 *
 * Everything here is server-only. The key id reaches the browser (it has to, the
 * checkout script needs it); the secret never does.
 */

const API = 'https://api.razorpay.com/v1';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
  /** Razorpay's own key prefix is the only honest source of truth for this. */
  isTestMode: boolean;
}

export function razorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;

  return {
    keyId,
    keySecret,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || undefined,
    isTestMode: keyId.startsWith('rzp_test'),
  };
}

export function paymentsConfigured(): boolean {
  return razorpayConfig() !== null;
}

function authHeader(c: RazorpayConfig): string {
  return 'Basic ' + Buffer.from(`${c.keyId}:${c.keySecret}`).toString('base64');
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const c = razorpayConfig();
  if (!c) throw new Error('PAYMENTS_NOT_CONFIGURED');

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(c),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  const body = (await res.json().catch(() => null)) as
    | (T & { error?: { description?: string; code?: string } })
    | null;

  if (!res.ok) {
    const message = body?.error?.description ?? `Razorpay returned ${res.status}`;
    throw new Error(`RAZORPAY: ${message}`);
  }
  return body as T;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

export function createRazorpayOrder(input: {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  return call<RazorpayOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
      // We capture ourselves after verifying, rather than letting the gateway
      // auto-capture something we have not yet reconciled to an order.
      payment_capture: 1,
    }),
  });
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string;
  amount: number;
  currency: string;
  error_description?: string | null;
  [key: string]: unknown;
}

export function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  return call<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

/* Signatures -------------------------------------------------------------- */

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The handshake the browser hands back after a successful payment. It proves the
 * payment belongs to our order, and that only someone holding the key secret
 * could have produced it. It is not, by itself, proof of capture: the payment is
 * still fetched from the API before anything is granted.
 */
export function verifyCheckoutSignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}): boolean {
  const c = razorpayConfig();
  if (!c) return false;

  const expected = createHmac('sha256', c.keySecret)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest('hex');

  return safeEqual(expected, input.signature);
}

/** Webhook bodies are signed over the exact bytes, so the raw string is required. */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const c = razorpayConfig();
  if (!c?.webhookSecret) return false;

  const expected = createHmac('sha256', c.webhookSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}
