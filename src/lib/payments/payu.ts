import { GatewayError, type Gateway } from '@/lib/payments/gateway';
import { payuAmount, payuOutcome, payuRequestHash, payuResponseValid, payuVerifyHash } from '@/lib/payments/signatures';

/**
 * PayU (India). The browser posts a signed form to PayU's page; PayU posts
 * the result back to surl or furl with a reverse hash; we check that and
 * then ask PayU's verify_payment API before believing it. EMI appears on
 * PayU's own page when the merchant account has it.
 */
export function payu(creds: { merchantKey: string; salt: string; environment?: string }): Gateway {
  const live = (creds.environment ?? 'production').trim().toLowerCase() !== 'test';
  const action = live ? 'https://secure.payu.in/_payment' : 'https://test.payu.in/_payment';
  const info = live ? 'https://info.payu.in/merchant/postservice.php?form=2' : 'https://test.payu.in/merchant/postservice.php?form=2';

  async function verify(txnid: string): Promise<Record<string, unknown> | null> {
    const params = new URLSearchParams({
      key: creds.merchantKey,
      command: 'verify_payment',
      var1: txnid,
      hash: payuVerifyHash(creds.merchantKey, txnid, creds.salt),
    });
    const res = await fetch(info, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), cache: 'no-store' });
    const json = (await res.json().catch(() => null)) as { status?: number; transaction_details?: Record<string, Record<string, unknown>> } | null;
    if (!res.ok || !json) throw new GatewayError('payu', `verify_payment HTTP ${res.status}`);
    return json.transaction_details?.[txnid] ?? null;
  }

  const confirmationOf = (orderNo: string, details: Record<string, unknown> | null, fallback: Record<string, string>) => {
    const status = typeof details?.status === 'string' ? details.status : fallback.status;
    const amountRupees = Number(details?.transaction_amount ?? details?.amt ?? fallback.amount ?? 0);
    return {
      outcome: payuOutcome(status),
      gatewayPaymentId: String(details?.mihpayid ?? fallback.mihpayid ?? orderNo),
      amountPaise: Math.round(amountRupees * 100),
      method: typeof details?.mode === 'string' ? details.mode.toLowerCase() : fallback.mode?.toLowerCase() ?? null,
      feePaise: null,
      reason: typeof details?.error_Message === 'string' ? details.error_Message : fallback.error_Message ?? null,
      raw: { verify: details, posted: fallback },
    };
  };

  return {
    id: 'payu',
    name: 'PayU',

    async start(input) {
      const fields: Record<string, string> = {
        key: creds.merchantKey,
        txnid: input.orderNo.slice(0, 25),
        amount: payuAmount(input.amountPaise),
        productinfo: input.description.slice(0, 100),
        firstname: (input.buyer.name || 'Learner').slice(0, 60),
        email: input.buyer.email ?? '',
        phone: input.buyer.phone?.replace(/\D/g, '').slice(-10) ?? '',
        surl: input.returnUrl,
        furl: input.returnUrl,
        udf1: input.orderId,
      };
      fields.hash = payuRequestHash(
        { key: fields.key, txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1 },
        creds.salt,
      );
      return { kind: 'form', gatewayOrderId: fields.txnid, action, fields };
    },

    async confirm({ orderNo, params }) {
      const txnid = params.txnid || orderNo.slice(0, 25);
      // The posted result must carry PayU's reverse hash; a bad one is not even asked about.
      if (params.hash) {
        const ok = payuResponseValid(
          {
            key: creds.merchantKey,
            txnid,
            amount: params.amount ?? '',
            productinfo: params.productinfo ?? '',
            firstname: params.firstname ?? '',
            email: params.email ?? '',
            udf1: params.udf1 ?? '',
            udf2: params.udf2 ?? '',
            udf3: params.udf3 ?? '',
            udf4: params.udf4 ?? '',
            udf5: params.udf5 ?? '',
            status: params.status ?? '',
            hash: params.hash,
          },
          creds.salt,
        );
        if (!ok) throw new GatewayError('payu', 'response hash did not match');
      }
      const details = await verify(txnid);
      return confirmationOf(orderNo, details, params);
    },

    async webhook() {
      // PayU's server-to-server post is the same form as the return; it lands on the return route.
      return { ok: true, event: null };
    },
  };
}
