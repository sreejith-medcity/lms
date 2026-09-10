/**
 * What the two loyalty engines agree on.
 *
 * No database import, so the contract between this product and a separate
 * rewards platform can be tested on its own. `loyalty-provider.ts` is the part
 * that reads a setting; this is the part that says what the words mean.
 */

export type LoyaltyEngine = 'built-in' | 'external' | 'off';

export function isEngine(value: unknown): value is LoyaltyEngine {
  return value === 'built-in' || value === 'external' || value === 'off';
}

/**
 * What the earn events are called on the wire.
 *
 * Declared here rather than typed at each call site, because the other side
 * subscribes to these names and a typo is a scheme that quietly never awards
 * for one kind of event.
 */
export const LOYALTY_EVENTS = {
  enrolled: 'enrolment.created',
  paid: 'payment.captured',
  attended: 'attendance.recorded',
  completed: 'course.completed',
  refunded: 'payment.refunded',
} as const;

/**
 * The identity the other platform matches a member on.
 *
 * Email is the join key because it is the only thing both systems reliably
 * have, but the internal id travels too: an academy that later lets somebody
 * change their email should be able to follow the member rather than losing
 * their balance.
 */
export interface MemberRef {
  userId: string;
  email: string | null;
  phone: string | null;
  name: string;
}

export function memberRef(user: {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
}): MemberRef {
  return { userId: user.id, email: user.email, phone: user.phone, name: user.name };
}
