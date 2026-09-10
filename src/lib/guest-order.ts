/**
 * Recognising the person who just paid, before they have a password.
 *
 * A guest checkout writes the buyer's own details and the basket cookie that
 * paid onto the order. That cookie is how the confirmation page knows this
 * browser is the one that bought this order: there is no session yet, and
 * asking somebody to sign in to see the thing they just paid for, with an
 * account they have not set a password on, is a dead end.
 *
 * It is a bearer token, so it is treated like one. It only ever grants a view
 * of that one order, and a session is only issued off the back of it once the
 * payment is confirmed and only when the account has no password to bypass.
 * An account that already has a password is never entered this way.
 */

export interface OrderContact {
  name?: string;
  email?: string;
  phone?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function guestTokenOf(billingAddress: unknown): string | null {
  const record = asRecord(billingAddress);
  const token = record?.guestToken;
  return typeof token === 'string' && token.length >= 16 ? token : null;
}

export function contactOf(billingAddress: unknown): OrderContact {
  const record = asRecord(billingAddress);
  if (!record) return {};
  const pick = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : undefined);
  return { name: pick('name'), email: pick('email'), phone: pick('phone') };
}

/**
 * May this browser see this order?
 *
 * Constant-time is not the concern here: the token is a 24 byte random value
 * and the order id is already needed to ask the question. What matters is that
 * a missing token never matches a missing token.
 */
export function mayViewOrder(input: {
  orderUserId: string;
  sessionUserId?: string | null;
  orderBillingAddress: unknown;
  cartCookie?: string | null;
}): boolean {
  if (input.sessionUserId && input.sessionUserId === input.orderUserId) return true;

  const token = guestTokenOf(input.orderBillingAddress);
  return Boolean(token && input.cartCookie && token === input.cartCookie);
}
