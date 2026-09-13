import { GatewayError, type Gateway } from '@/lib/payments/gateway';
import { phonepeCallbackValid, phonepeOutcome, phonepeVerify } from '@/lib/payments/signatures';

/**
 * PhonePe PG, standard checkout (the hosted pay page). UPI first, which is
 * what a walk-in learner reaches for. The buyer is sent to PhonePe's page,
 * PhonePe posts back to us, and we ask PhonePe's status API before believing
 * anything. Sandbox and production differ only by host.
 */
export function phonepe(creds: { merchantId: string; saltKey: string; saltIndex: string; environment?: string }): Gateway {
  const live = (creds.environment ?? 'production').trim().toLowerCase() !== 'sandbox';
  const host = live ? 'https://api.phonepe.com/apis/hermes' : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
  const saltIndex = creds.saltIndex.trim() || '1';

  async function call(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const base64 = body ? Buffer.from(JSON.stringify(body)).toString('base64') : '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-VERIFY': phonepeVerify(base64, path, creds.saltKey, saltIndex),
      ...(body ? {} : { 'X-MERCHANT-ID': creds.merchantId }),
    };
    const res = await fetch(`${host}${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify({ request: base64 }) : undefined,
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !json) throw new GatewayError('phonepe', `HTTP ${res.status}${json?.message ? `: ${json.message}` : ''}`);
    return json;
  }

  const paymentOf = (data: Record<string, unknown> | undefined) => {
    const instrument = (data?.paymentInstrument ?? {}) as Record<string, unknown>;
    return {
      gatewayPaymentId: String(data?.transactionId ?? data?.merchantTransactionId ?? ''),
      amountPaise: typeof data?.amount === 'number' ? data.amount : 0,
      method: typeof instrument.type === 'string' ? instrument.type.toLowerCase() : null,
    };
  };

  async function status(orderNo: string) {
    const path = `/pg/v1/status/${creds.merchantId}/${orderNo}`;
    const json = await call(path);
    const data = json.data as Record<string, unknown> | undefined;
    const p = paymentOf(data);
    return {
      outcome: phonepeOutcome(typeof json.code === 'string' ? json.code : undefined),
      gatewayPaymentId: p.gatewayPaymentId || orderNo,
      amountPaise: p.amountPaise,
      method: p.method,
      feePaise: null,
      reason: typeof json.message === 'string' ? json.message : null,
      raw: json,
    };
  }

  return {
    id: 'phonepe',
    name: 'PhonePe',

    async start(input) {
      const json = await call('/pg/v1/pay', {
        merchantId: creds.merchantId,
        merchantTransactionId: input.orderNo.slice(0, 35),
        merchantUserId: input.buyer.email ?? input.buyer.phone ?? 'guest',
        amount: input.amountPaise,
        redirectUrl: input.returnUrl,
        redirectMode: 'POST',
        callbackUrl: input.notifyUrl,
        mobileNumber: input.buyer.phone?.replace(/\D/g, '').slice(-10) || undefined,
        paymentInstrument: { type: 'PAY_PAGE' },
      });
      const data = json.data as { instrumentResponse?: { redirectInfo?: { url?: string } } } | undefined;
      const url = data?.instrumentResponse?.redirectInfo?.url;
      if (!url) throw new GatewayError('phonepe', 'no pay page URL returned');
      return { kind: 'redirect', gatewayOrderId: input.orderNo.slice(0, 35), url };
    },

    async confirm({ orderNo }) {
      return status(orderNo);
    },

    async webhook(rawBody, headers) {
      let body: { response?: string } | null = null;
      try {
        body = JSON.parse(rawBody) as { response?: string };
      } catch {
        return { ok: false, reason: 'malformed body' };
      }
      const response = body?.response;
      if (!response) return { ok: false, reason: 'no response field' };
      if (!phonepeCallbackValid(response, headers.get('x-verify'), creds.saltKey, saltIndex)) return { ok: false, reason: 'bad signature' };
      const decoded = JSON.parse(Buffer.from(response, 'base64').toString('utf8')) as Record<string, unknown>;
      const data = decoded.data as Record<string, unknown> | undefined;
      const orderNo = typeof data?.merchantTransactionId === 'string' ? data.merchantTransactionId : null;
      if (!orderNo) return { ok: true, event: null };
      // The callback says what happened; the status API is asked before money is trusted.
      const confirmation = await status(orderNo);
      return { ok: true, event: { orderNo, gatewayOrderId: orderNo, confirmation } };
    },
  };
}
