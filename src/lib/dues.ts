/**
 * Fees owed, and what to do about them.
 *
 * Everything here is arithmetic over instalment rows, kept away from the
 * database so it can be checked in isolation: how old a debt is, how a sum
 * handed across the counter settles against a schedule, when a reminder is
 * owed, and how a receipt gets its number. The screens and the cron read these
 * answers; they do not work them out again.
 *
 * All money is paise. Dates are compared as instants; "days" are whole
 * 24-hour spans, which is what a branch office means by "a week late".
 */

export interface InstalmentRow {
  id: string;
  sequence: number;
  amountPaise: number;
  /** Collected so far. Never more than amountPaise. */
  paidPaise: number;
  dueDate: Date;
  paidAt: Date | null;
}

/** What is still owed on one instalment. */
export function balanceOf(row: Pick<InstalmentRow, 'amountPaise' | 'paidPaise'>): number {
  return Math.max(0, row.amountPaise - row.paidPaise);
}

export const DAY_MS = 864e5;

/** Whole days since the due date. Negative before it, zero on the day. */
export function daysOverdue(dueDate: Date, now: Date): number {
  return Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS);
}

/**
 * Ageing buckets, in the shape an accounts person expects to see them. The
 * bucket is decided by the oldest unpaid instalment, because that is the
 * one the conversation with the learner is about.
 */
export type AgeBucket = 'CURRENT' | 'DUE_SOON' | 'D1_7' | 'D8_30' | 'D31_60' | 'D60_PLUS';

export const AGE_BUCKETS: { key: AgeBucket; label: string; short: string }[] = [
  { key: 'D60_PLUS', label: 'Over 60 days late', short: '60+' },
  { key: 'D31_60', label: '31 to 60 days late', short: '31-60' },
  { key: 'D8_30', label: '8 to 30 days late', short: '8-30' },
  { key: 'D1_7', label: 'Up to a week late', short: '1-7' },
  { key: 'DUE_SOON', label: 'Due in the next 7 days', short: 'soon' },
  { key: 'CURRENT', label: 'Not yet due', short: 'later' },
];

export function ageBucket(dueDate: Date, now: Date): AgeBucket {
  const days = daysOverdue(dueDate, now);
  if (days > 60) return 'D60_PLUS';
  if (days > 30) return 'D31_60';
  if (days > 7) return 'D8_30';
  if (days >= 1) return 'D1_7';
  if (days >= -7) return 'DUE_SOON';
  return 'CURRENT';
}

/** Higher is worse. Used to put the accounts most in need of a call first. */
const SEVERITY: Record<AgeBucket, number> = {
  D60_PLUS: 5,
  D31_60: 4,
  D8_30: 3,
  D1_7: 2,
  DUE_SOON: 1,
  CURRENT: 0,
};

export interface AccountSummary {
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  overduePaise: number;
  /** Owed and past due, or due within a week: what the next call is about. */
  nextDue: { sequence: number; balancePaise: number; dueDate: Date } | null;
  oldestOverdueDays: number;
  bucket: AgeBucket;
  settled: boolean;
}

/**
 * One learner's position on one fee plan. Rows may arrive in any order.
 */
export function summariseAccount(rows: InstalmentRow[], now: Date): AccountSummary {
  const sorted = [...rows].sort((a, b) => a.sequence - b.sequence);
  const totalPaise = sorted.reduce((n, r) => n + r.amountPaise, 0);
  const paidPaise = sorted.reduce((n, r) => n + Math.min(r.paidPaise, r.amountPaise), 0);
  const open = sorted.filter((r) => balanceOf(r) > 0);

  const overdue = open.filter((r) => daysOverdue(r.dueDate, now) >= 1);
  const overduePaise = overdue.reduce((n, r) => n + balanceOf(r), 0);
  const oldest = open.length ? open.reduce((a, b) => (a.dueDate <= b.dueDate ? a : b)) : null;

  const next = open.length ? open.reduce((a, b) => (a.dueDate <= b.dueDate ? a : b)) : null;

  return {
    totalPaise,
    paidPaise,
    balancePaise: totalPaise - paidPaise,
    overduePaise,
    nextDue: next
      ? { sequence: next.sequence, balancePaise: balanceOf(next), dueDate: next.dueDate }
      : null,
    oldestOverdueDays: oldest ? Math.max(0, daysOverdue(oldest.dueDate, now)) : 0,
    bucket: oldest ? ageBucket(oldest.dueDate, now) : 'CURRENT',
    settled: open.length === 0,
  };
}

/**
 * Worst first: the account that has been waiting longest, then the one
 * owing most. A tie on both keeps the incoming order, so a stable sort of an
 * already sensible list stays sensible.
 */
export function worstFirst<T extends { summary: AccountSummary }>(accounts: T[]): T[] {
  return [...accounts].sort((a, b) => {
    const severity = SEVERITY[b.summary.bucket] - SEVERITY[a.summary.bucket];
    if (severity) return severity;
    const age = b.summary.oldestOverdueDays - a.summary.oldestOverdueDays;
    if (age) return age;
    return b.summary.balancePaise - a.summary.balancePaise;
  });
}

/**
 * One line for the learner's home page, or nothing. Overdue money is said
 * first; otherwise the next due date within a week.
 */
export function feeNoticeFor(
  rows: Pick<InstalmentRow, 'amountPaise' | 'paidPaise' | 'dueDate'>[],
  now: Date,
  currency: string,
): { text: string; overdue: boolean } | null {
  const open = rows.filter((r) => balanceOf(r) > 0);
  if (!open.length) return null;

  const overdue = open.filter((r) => daysOverdue(r.dueDate, now) >= 1);
  const money = (paise: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(paise / 100);

  if (overdue.length) {
    const sum = overdue.reduce((n, r) => n + balanceOf(r), 0);
    return { text: `${money(sum)} of your fees is overdue.`, overdue: true };
  }

  const next = open.reduce((a, b) => (a.dueDate <= b.dueDate ? a : b));
  const days = -daysOverdue(next.dueDate, now);
  if (days > 7) return null;
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return { text: `${money(balanceOf(next))} of your fees is due ${when}.`, overdue: false };
}

/* Allocation ---------------------------------------------------------------- */

export interface Allocation {
  instalmentId: string;
  sequence: number;
  paise: number;
  /** True when this allocation clears the instalment. */
  settles: boolean;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Money that exceeded everything owed. Refused, not kept. */
  unallocatedPaise: number;
}

/**
 * Settles a sum against a schedule, oldest due first, allowing a part
 * payment on the last instalment it reaches. Money is never put on a later
 * instalment while an earlier one is open: that is the rule every branch
 * office already follows, and following it here keeps the ageing honest.
 *
 * Anything beyond the total balance is reported back as unallocated so the
 * caller refuses it, rather than quietly recorded as a credit nobody tracks.
 */
export function allocatePayment(rows: InstalmentRow[], paise: number): AllocationResult {
  if (!Number.isInteger(paise) || paise <= 0) {
    return { allocations: [], unallocatedPaise: Math.max(0, paise) };
  }

  const open = rows
    .filter((r) => balanceOf(r) > 0)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.sequence - b.sequence);

  const allocations: Allocation[] = [];
  let left = paise;

  for (const row of open) {
    if (left <= 0) break;
    const balance = balanceOf(row);
    const take = Math.min(balance, left);
    allocations.push({
      instalmentId: row.id,
      sequence: row.sequence,
      paise: take,
      settles: take === balance,
    });
    left -= take;
  }

  return { allocations, unallocatedPaise: left };
}

/* Reminders ------------------------------------------------------------------ */

export type ReminderStage = 'BEFORE' | 'ON_DAY' | 'WEEK' | 'FORTNIGHT';

/**
 * Four touches per instalment: a heads-up three days before, a note on the
 * day after it lapses, then at a week and a fortnight. After that it is a
 * phone call, not a message, which is what the dues screen is for.
 */
export const REMINDER_STAGES: { stage: ReminderStage; offsetDays: number; tone: string }[] = [
  { stage: 'BEFORE', offsetDays: -3, tone: 'coming up' },
  { stage: 'ON_DAY', offsetDays: 1, tone: 'now due' },
  { stage: 'WEEK', offsetDays: 7, tone: 'a week overdue' },
  { stage: 'FORTNIGHT', offsetDays: 14, tone: 'two weeks overdue' },
];

/**
 * Which reminder is owed right now, if any. Only the latest stage whose day
 * has arrived is returned: a learner who was somehow never reminded and is
 * now 20 days late gets the fortnight message once, not four messages in a
 * row. Each stage carries its own dedupe key so a cron running every few
 * minutes queues each one exactly once.
 */
export function reminderDue(
  row: Pick<InstalmentRow, 'id' | 'dueDate' | 'amountPaise' | 'paidPaise'>,
  now: Date,
): { stage: ReminderStage; dedupeKey: string; tone: string } | null {
  if (balanceOf(row) <= 0) return null;
  const days = daysOverdue(row.dueDate, now);

  let hit: (typeof REMINDER_STAGES)[number] | null = null;
  for (const candidate of REMINDER_STAGES) {
    if (days >= candidate.offsetDays) hit = candidate;
  }
  if (!hit) return null;

  return {
    stage: hit.stage,
    tone: hit.tone,
    dedupeKey: `instalment:${row.id}:${hit.stage}`,
  };
}

/* Receipts -------------------------------------------------------------------- */

export function receiptPrefix(year: number): string {
  return `RCP-${year}-`;
}

/**
 * Same discipline as invoice numbers: the next number is the highest issued
 * plus one, per academy and per year, never a row count.
 */
export function nextReceiptNumber(latest: string | null | undefined, prefix: string): string {
  const tail = latest?.startsWith(prefix) ? latest.slice(prefix.length) : '';
  const last = /^\d+$/.test(tail) ? Number.parseInt(tail, 10) : 0;
  const next = Number.isSafeInteger(last) && last > 0 ? last + 1 : 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

/* Schedules -------------------------------------------------------------------- */

export interface ScheduledPart {
  sequence: number;
  amountPaise: number;
  dueDate: Date;
}

/**
 * Turns a pricing plan into dated parts. A plan can spell its parts out
 * (`[{ dueOffsetDays, amountPaise }]`), in which case they are used as
 * written and the amounts must add up; otherwise the price is split evenly
 * with the remainder on the first part, so the parts always add back up to
 * the total exactly. The first part is due at once: that is what the learner
 * pays to enrol.
 */
export function scheduleFromPlan(
  plan: {
    pricePaise: number;
    instalmentCount: number;
    instalmentPlan?: unknown;
  },
  from: Date,
): ScheduledPart[] {
  const spelled = Array.isArray(plan.instalmentPlan)
    ? plan.instalmentPlan
        .map((p) => ({
          dueOffsetDays: Number((p as { dueOffsetDays?: unknown })?.dueOffsetDays),
          amountPaise: Number((p as { amountPaise?: unknown })?.amountPaise),
        }))
        .filter((p) => Number.isInteger(p.dueOffsetDays) && Number.isInteger(p.amountPaise) && p.amountPaise > 0)
    : [];

  if (spelled.length > 1 && spelled.reduce((n, p) => n + p.amountPaise, 0) === plan.pricePaise) {
    return spelled
      .sort((a, b) => a.dueOffsetDays - b.dueOffsetDays)
      .map((p, i) => ({
        sequence: i + 1,
        amountPaise: p.amountPaise,
        dueDate: new Date(from.getTime() + Math.max(0, p.dueOffsetDays) * DAY_MS),
      }));
  }

  const count = Math.max(1, Math.floor(plan.instalmentCount));
  const each = Math.floor(plan.pricePaise / count);
  const remainder = plan.pricePaise - each * count;

  return Array.from({ length: count }, (_, i) => ({
    sequence: i + 1,
    amountPaise: i === 0 ? each + remainder : each,
    dueDate: new Date(from.getTime() + i * 30 * DAY_MS),
  }));
}
