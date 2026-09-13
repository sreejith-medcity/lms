/**
 * The arithmetic and the state machine behind tenant billing. No database,
 * so every rule that decides whether an academy keeps working can be
 * tested on its own.
 */

export type Cycle = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface PlanPrices {
  monthlyPaise: number;
  quarterlyPaise: number | null;
  annualPaise: number | null;
}

/** What one period costs on a cycle; the discounted figures fall back to multiples of monthly. */
export function cycleAmount(plan: PlanPrices, cycle: Cycle): number {
  if (cycle === 'ANNUAL') return plan.annualPaise ?? plan.monthlyPaise * 12;
  if (cycle === 'QUARTERLY') return plan.quarterlyPaise ?? plan.monthlyPaise * 3;
  return plan.monthlyPaise;
}

export function cycleMonths(cycle: Cycle): number {
  return cycle === 'ANNUAL' ? 12 : cycle === 'QUARTERLY' ? 3 : 1;
}

/** The end of a period that starts at `start`, the same day of the month later, in UTC. */
export function periodEnd(start: Date, cycle: Cycle): Date {
  const d = new Date(start);
  d.setUTCMonth(d.getUTCMonth() + cycleMonths(cycle));
  return d;
}

export interface LimitRow {
  metric: string;
  included: number;
  hardCap: number | null;
  overagePaisePerUnit: number;
}

export interface UsageRow {
  metric: string;
  quantity: number;
}

export interface OverageLine {
  metric: string;
  used: number;
  included: number;
  over: number;
  paise: number;
}

/** Usage beyond what the plan includes, priced per unit; hard-capped metrics never bill, they refuse. */
export function overageLines(usage: UsageRow[], limits: LimitRow[]): OverageLine[] {
  const out: OverageLine[] = [];
  for (const l of limits) {
    if (l.overagePaisePerUnit <= 0) continue;
    const used = usage.find((u) => u.metric === l.metric)?.quantity ?? 0;
    const over = Math.max(0, used - l.included);
    if (over > 0) out.push({ metric: l.metric, used, included: l.included, over, paise: over * l.overagePaisePerUnit });
  }
  return out;
}

export const PLATFORM_GST_PERCENT = 18;

export interface InvoiceTotals {
  subtotalPaise: number;
  overagePaise: number;
  taxPaise: number;
  totalPaise: number;
}

export function invoiceTotals(subscriptionPaise: number, overage: OverageLine[], gstPercent = PLATFORM_GST_PERCENT): InvoiceTotals {
  const overagePaise = overage.reduce((n, o) => n + o.paise, 0);
  const taxable = subscriptionPaise + overagePaise;
  const taxPaise = Math.round((taxable * gstPercent) / 100);
  return { subtotalPaise: subscriptionPaise, overagePaise, taxPaise, totalPaise: taxable + taxPaise };
}

/** Days an invoice may be unpaid past its due date before the academy is paused. */
export const GRACE_DAYS = 14;
/** Days after the period ends that an invoice falls due. */
export const DUE_DAYS = 7;

export interface StandingInput {
  tenantStatus: string;
  subscriptionStatus: string;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  /** The oldest unpaid invoice's due date, if any. */
  oldestDueUnpaid: Date | null;
}

export type Standing =
  | { action: 'none' }
  | { action: 'trial-ended' }
  | { action: 'renew' }
  | { action: 'past-due' }
  | { action: 'suspend' };

/**
 * What the nightly run should do with a tenant. In order of severity:
 * a trial that has run out gets its first invoice; an active period that
 * has ended is renewed with an invoice; an invoice past due marks the
 * academy past due; an invoice past due and past grace pauses it.
 */
export function standing(s: StandingInput, now: Date): Standing {
  if (s.tenantStatus === 'CANCELLED' || s.tenantStatus === 'SUSPENDED') return { action: 'none' };
  if (s.oldestDueUnpaid) {
    const overdueBy = (now.getTime() - s.oldestDueUnpaid.getTime()) / 864e5;
    if (overdueBy > GRACE_DAYS) return { action: 'suspend' };
    if (overdueBy > 0 && s.tenantStatus !== 'PAST_DUE') return { action: 'past-due' };
  }
  if (s.subscriptionStatus === 'TRIALING' && s.currentPeriodEnd.getTime() <= now.getTime()) return { action: 'trial-ended' };
  if (s.subscriptionStatus === 'ACTIVE' && s.currentPeriodEnd.getTime() <= now.getTime()) return { action: 'renew' };
  return { action: 'none' };
}

export function invoiceNumber(year: number, sequence: number): string {
  return `PLT-${year}-${String(sequence).padStart(5, '0')}`;
}

export const METRIC_LABEL: Record<string, string> = {
  ACTIVE_LEARNERS: 'Active learners',
  STAFF_SEATS: 'Staff seats',
  BRANCHES: 'Branches',
  COURSES: 'Courses',
  STORAGE_BYTES: 'Storage',
  BANDWIDTH_BYTES: 'Bandwidth',
  LIVE_SESSION_MINUTES: 'Live class minutes',
  RECORDING_MINUTES: 'Recording minutes',
};

export function metricValue(metric: string, quantity: number): string {
  if (metric.endsWith('_BYTES')) {
    const gb = quantity / 1024 ** 3;
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(quantity / 1024 ** 2).toFixed(0)} MB`;
  }
  return quantity.toLocaleString('en-IN');
}

/** Whether a hard cap refuses one more of a metric. */
export function capReached(limits: LimitRow[], metric: string, used: number): boolean {
  const l = limits.find((x) => x.metric === metric);
  if (!l || l.hardCap === null) return false;
  return used >= l.hardCap;
}
