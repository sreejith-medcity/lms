import { balanceOf } from '@/lib/dues';

/**
 * What a parent's fee screen says about each instalment, and which button
 * it offers. Pure, so the wording rules can be tested without the ledger.
 *
 * The one rule that matters most: nothing is called paid until the bank
 * confirms it. An order in flight shows as "processing" against its
 * instalment and blocks a second Pay button, so a parent whose payment
 * window closed halfway never pays twice.
 */

export interface InFlightOrder {
  id: string;
  status: 'PENDING' | 'FAILED' | 'CANCELLED' | 'PAID' | 'REFUNDED' | string;
  gatewayOrderId: string | null;
  items: { instalmentId: string | null; miscFeeId: string | null }[];
}

/** Orders the gateway has been asked to take but has not confirmed. */
export function processingOrders<T extends InFlightOrder>(orders: T[]): T[] {
  return orders.filter((o) => o.status === 'PENDING' && Boolean(o.gatewayOrderId));
}

/** Orders that ended without money moving, worth telling the parent about. */
export function failedOrders<T extends InFlightOrder>(orders: T[]): T[] {
  return orders.filter((o) => o.status === 'FAILED' || o.status === 'CANCELLED');
}

/** The in-flight order for an instalment or a charge, if any. */
export function inFlightFor<T extends InFlightOrder>(orders: T[], target: { instalmentId?: string | null; miscFeeId?: string | null }): T | null {
  const list = processingOrders(orders);
  return (
    list.find((o) =>
      o.items.some((i) => (target.instalmentId ? i.instalmentId === target.instalmentId : false) || (target.miscFeeId ? i.miscFeeId === target.miscFeeId : false)),
    ) ?? null
  );
}

export type InstalmentState = 'paid' | 'processing' | 'part-paid' | 'overdue' | 'due';

export function instalmentState(i: { amountPaise: number; paidPaise: number; dueDate: Date }, inFlight: boolean, now: Date): InstalmentState {
  if (balanceOf(i) <= 0) return 'paid';
  if (inFlight) return 'processing';
  if (i.paidPaise > 0) return 'part-paid';
  if (i.dueDate < now) return 'overdue';
  return 'due';
}

export type PayOffer = 'pay-online' | 'processing' | 'at-academy' | 'nothing-due';

/** Which control sits next to "Next payment". */
export function payOffer(input: { next: { amountPaise: number; paidPaise: number } | null; inFlight: boolean; online: boolean }): PayOffer {
  if (!input.next || balanceOf(input.next) <= 0) return 'nothing-due';
  if (input.inFlight) return 'processing';
  return input.online ? 'pay-online' : 'at-academy';
}
