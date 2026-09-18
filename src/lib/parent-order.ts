import { db } from '@/lib/db';
import { getParentSession } from '@/lib/parent-session';

/**
 * A parent at the checkout of a child's order.
 *
 * The order is the child's: the instalment it pays belongs to the child's
 * enrolment and the receipt goes on the child's ledger. What lets the parent
 * open the checkout, press Pay and read the confirmation is their own
 * session plus an active link to that child. That is checked here, once, by
 * every route on the payment path, so the parent is never confused with a
 * guest buyer: a guest with no password is signed in as the learner once the
 * money lands, and a parent must never be.
 */
export interface PayingParent {
  contact: string;
  childId: string;
}

export async function parentOfOrder(organizationId: string, orderUserId: string): Promise<PayingParent | null> {
  const session = await getParentSession();
  if (!session || session.organizationId !== organizationId) return null;
  const link = await db.parentLink.findFirst({
    where: { organizationId, contact: session.contact, learnerId: orderUserId, status: 'ACTIVE' },
    select: { id: true },
  });
  return link ? { contact: session.contact, childId: orderUserId } : null;
}
