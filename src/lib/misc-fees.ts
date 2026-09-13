import { DAY_MS } from '@/lib/dues';

/**
 * Miscellaneous fees: the charges beyond the course fee.
 *
 * An exam fee, study material, a certificate reissued, a late fee. Raised
 * by the office against a learner's enrolment, paid at the counter or
 * online, or waived with a reason that stays on the record.
 */

export type MiscFeeStatus = 'PENDING' | 'PAID' | 'WAIVED' | 'CANCELLED';

export interface MiscFeeRow {
  amountPaise: number;
  dueDate: Date | null;
  status: MiscFeeStatus | string;
}

export function feeProblem(input: { label: string; amountPaise: number }): string | null {
  if (input.label.trim().length < 2) return 'Say what the charge is for.';
  if (!Number.isFinite(input.amountPaise) || input.amountPaise <= 0) return 'Enter an amount above zero.';
  if (input.amountPaise > 10_000_000_00) return 'That amount looks wrong.';
  return null;
}

export function feeTypeProblem(input: { name: string; amountPaise: number }): string | null {
  if (input.name.trim().length < 2) return 'Give the fee a name.';
  if (!Number.isFinite(input.amountPaise) || input.amountPaise < 0) return 'The usual amount cannot be negative.';
  return null;
}

export function isOpen(fee: Pick<MiscFeeRow, 'status'>): boolean {
  return fee.status === 'PENDING';
}

/** Days past due, or 0 when not due yet or there is no date. */
export function feeDaysOverdue(fee: Pick<MiscFeeRow, 'dueDate' | 'status'>, now: Date): number {
  if (!isOpen(fee) || !fee.dueDate) return 0;
  return Math.max(0, Math.floor((now.getTime() - fee.dueDate.getTime()) / DAY_MS));
}

/** "Due 14 Sep", "3 days late", "Paid", "Waived". */
export function feeStatusLabel(fee: MiscFeeRow, now: Date): { text: string; tone: 'neutral' | 'ok' | 'warn' | 'bad' } {
  if (fee.status === 'PAID') return { text: 'Paid', tone: 'ok' };
  if (fee.status === 'WAIVED') return { text: 'Waived', tone: 'neutral' };
  if (fee.status === 'CANCELLED') return { text: 'Cancelled', tone: 'neutral' };
  const late = feeDaysOverdue(fee, now);
  if (late > 0) return { text: `${late} day${late === 1 ? '' : 's'} late`, tone: 'bad' };
  if (!fee.dueDate) return { text: 'Open', tone: 'warn' };
  const days = Math.ceil((fee.dueDate.getTime() - now.getTime()) / DAY_MS);
  return { text: days <= 0 ? 'Due today' : days <= 7 ? `Due in ${days} day${days === 1 ? '' : 's'}` : `Due ${fee.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, tone: days <= 7 ? 'warn' : 'neutral' };
}

export interface MiscFeeSummary {
  openPaise: number;
  openCount: number;
  overduePaise: number;
  paidPaise: number;
}

export function summariseFees(rows: MiscFeeRow[], now: Date): MiscFeeSummary {
  const out: MiscFeeSummary = { openPaise: 0, openCount: 0, overduePaise: 0, paidPaise: 0 };
  for (const r of rows) {
    if (r.status === 'PAID') out.paidPaise += r.amountPaise;
    if (!isOpen(r)) continue;
    out.openPaise += r.amountPaise;
    out.openCount += 1;
    if (feeDaysOverdue(r, now) > 0) out.overduePaise += r.amountPaise;
  }
  return out;
}

/** Why it cannot be waived or paid now, or null. */
export function closeProblem(fee: Pick<MiscFeeRow, 'status'>): string | null {
  if (fee.status === 'PAID') return 'This fee is already paid.';
  if (fee.status === 'WAIVED') return 'This fee was waived.';
  if (fee.status === 'CANCELLED') return 'This fee was cancelled.';
  return null;
}
