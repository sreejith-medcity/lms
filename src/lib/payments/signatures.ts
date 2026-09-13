import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The arithmetic each gateway checks, kept apart from the HTTP so it can be
 * tested against the worked examples in their documentation.
 */

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* PhonePe ------------------------------------------------------------------- */

/** X-VERIFY for a request: sha256(base64Payload + path + saltKey) + "###" + saltIndex. */
export function phonepeVerify(base64Payload: string, path: string, saltKey: string, saltIndex: string): string {
  return `${createHash('sha256').update(`${base64Payload}${path}${saltKey}`).digest('hex')}###${saltIndex}`;
}

/** X-VERIFY on a callback: sha256(base64Response + saltKey) + "###" + saltIndex. */
export function phonepeCallbackValid(base64Response: string, header: string | null, saltKey: string, saltIndex: string): boolean {
  if (!header) return false;
  const expected = `${createHash('sha256').update(`${base64Response}${saltKey}`).digest('hex')}###${saltIndex}`;
  return same(expected, header.trim());
}

/* PayU ---------------------------------------------------------------------- */

export interface PayuFields {
  key: string;
  txnid: string;
  /** Rupees with two decimals, "1234.00", exactly as posted. */
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
}

/** sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt). */
export function payuRequestHash(f: PayuFields, salt: string): string {
  const parts = [f.key, f.txnid, f.amount, f.productinfo, f.firstname, f.email, f.udf1 ?? '', f.udf2 ?? '', f.udf3 ?? '', f.udf4 ?? '', f.udf5 ?? '', '', '', '', '', '', salt];
  return createHash('sha512').update(parts.join('|')).digest('hex');
}

/** The reverse hash on the response: sha512(salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key). */
export function payuResponseHash(f: PayuFields & { status: string }, salt: string): string {
  const parts = [salt, f.status, '', '', '', '', '', f.udf5 ?? '', f.udf4 ?? '', f.udf3 ?? '', f.udf2 ?? '', f.udf1 ?? '', f.email, f.firstname, f.productinfo, f.amount, f.txnid, f.key];
  return createHash('sha512').update(parts.join('|')).digest('hex');
}

export function payuResponseValid(f: PayuFields & { status: string; hash: string }, salt: string): boolean {
  return same(payuResponseHash(f, salt), f.hash.toLowerCase());
}

/** The hash for the verify_payment API: sha512(key|verify_payment|txnid|salt). */
export function payuVerifyHash(key: string, txnid: string, salt: string): string {
  return createHash('sha512').update(`${key}|verify_payment|${txnid}|${salt}`).digest('hex');
}

/** Rupees as PayU wants them: "1234.00". */
export function payuAmount(paise: number): string {
  return (paise / 100).toFixed(2);
}

/* Stripe -------------------------------------------------------------------- */

/**
 * Stripe-Signature: "t=<unix>,v1=<hmac>[,v1=...]"; the HMAC-SHA256 of
 * "<t>.<raw body>" with the endpoint secret, and t within tolerance.
 */
export function stripeSignatureValid(rawBody: string, header: string | null, secret: string, now = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = Object.create(null) as Record<string, string[]>;
  for (const piece of header.split(',')) {
    const [k, v] = piece.split('=', 2);
    if (!k || v === undefined) continue;
    (parts[k.trim()] ??= []).push(v.trim());
  }
  const t = Number(parts.t?.[0]);
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return (parts.v1 ?? []).some((sig) => same(expected, sig));
}

/** Form-encode the nested keys Stripe's API takes: a[b][c]=v. */
export function stripeForm(obj: Record<string, unknown>, prefix = ''): string {
  const out: string[] = [];
  const walk = (value: unknown, key: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, key ? `${key}[${k}]` : k);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  walk(obj, prefix);
  return out.join('&');
}

/* Shared -------------------------------------------------------------------- */

/** The status words the gateways use, folded into ours. */
export type GatewayOutcome = 'PAID' | 'PENDING' | 'FAILED';

export function phonepeOutcome(code: string | undefined): GatewayOutcome {
  if (code === 'PAYMENT_SUCCESS') return 'PAID';
  if (code === 'PAYMENT_PENDING') return 'PENDING';
  return 'FAILED';
}

export function payuOutcome(status: string | undefined): GatewayOutcome {
  const s = (status ?? '').toLowerCase();
  if (s === 'success' || s === 'captured') return 'PAID';
  if (s === 'pending' || s === 'in progress') return 'PENDING';
  return 'FAILED';
}

export function stripeOutcome(paymentStatus: string | undefined, sessionStatus: string | undefined): GatewayOutcome {
  if (paymentStatus === 'paid') return 'PAID';
  if (sessionStatus === 'expired') return 'FAILED';
  return 'PENDING';
}
