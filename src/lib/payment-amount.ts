/**
 * Does what the gateway took match what we charged?
 *
 * The plain answer is "the two numbers are equal", and that is what this used
 * to check. It refuses a real payment in one ordinary case: an account
 * configured so the customer pays the gateway's fee. Razorpay then captures
 * the order amount plus its own fee and the GST on that fee, so a ₹8,260
 * order arrives as a ₹8,552.40 payment, three and a half percent more, and a
 * strict equality check reads a correct payment as tampering and leaves the
 * money taken with nobody enrolled.
 *
 * So the question is asked properly: after the fee the customer was charged
 * on our behalf, is the academy being paid what the order said? Anything else
 * is still refused, and refused loudly, because an amount that does not
 * reconcile is the one thing that must never be waved through.
 */

export interface AmountCheck {
  ok: boolean;
  /** What the gateway actually took from the card. */
  grossPaise: number;
  /** What the order was for. */
  orderPaise: number;
  /** The gateway's fee, where the customer paid it rather than the academy. */
  customerPaidFeePaise: number;
  /** Why it was refused, in the words the admin screen shows. */
  reason?: 'UNDERPAID' | 'OVERPAID' | 'NOT_THE_FEE';
}

/**
 * Razorpay reports fees in paise, inclusive of the GST charged on the fee.
 * A rupee of slack absorbs the rounding Razorpay does on that GST rather
 * than turning it into a refused payment.
 */
const SLACK_PAISE = 100;

export function checkPaidAmount(input: {
  grossPaise: number;
  orderPaise: number;
  /** From the payment object. Absent on older records and on some methods. */
  feePaise?: number | null;
}): AmountCheck {
  const gross = Math.round(input.grossPaise);
  const order = Math.round(input.orderPaise);
  const fee = Math.max(0, Math.round(input.feePaise ?? 0));

  const base = { grossPaise: gross, orderPaise: order, customerPaidFeePaise: 0 };

  // The ordinary case: the academy bears the gateway's fee, so what was taken
  // is what the order said.
  if (gross === order) return { ...base, ok: true };

  if (gross < order) return { ...base, ok: false, reason: 'UNDERPAID' };

  // More was taken than the order. It is only acceptable when the difference
  // is the fee the customer was charged for us, which nets back to the order.
  const difference = gross - order;
  if (fee > 0 && Math.abs(difference - fee) <= SLACK_PAISE) {
    return { ...base, ok: true, customerPaidFeePaise: difference };
  }

  return { ...base, ok: false, reason: fee > 0 ? 'NOT_THE_FEE' : 'OVERPAID' };
}

/** One sentence for the admin, and for the record written when it is refused. */
export function explainAmount(check: AmountCheck, format: (paise: number) => string): string {
  if (check.ok && check.customerPaidFeePaise > 0) {
    return `The customer paid ${format(check.grossPaise)}, which is the ${format(
      check.orderPaise,
    )} order plus ${format(check.customerPaidFeePaise)} of gateway fee they were charged.`;
  }
  if (check.ok) return `Paid in full: ${format(check.grossPaise)}.`;

  if (check.reason === 'UNDERPAID') {
    return `The gateway took ${format(check.grossPaise)}, less than the ${format(
      check.orderPaise,
    )} the order was for. Nothing was granted.`;
  }
  return `The gateway took ${format(check.grossPaise)} against an order priced at ${format(
    check.orderPaise,
  )}, and the difference is not the gateway's own fee. Nothing was granted on a guess.`;
}
