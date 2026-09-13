import { addMonths, dayKey, dayStart } from '@/lib/clock';

/**
 * Instructor payouts: what a trainer is owed for the classes they took.
 *
 * The arithmetic is deliberately dull. Minutes come from the class as
 * scheduled (a class that ran ten minutes over is still one class), the
 * rate is whichever the profile carries, and everything else is an
 * adjustment with a reason typed by a person.
 */

export interface PayoutLine {
  sessionId: string;
  title: string;
  startsAt: string;
  minutes: number;
  batch: string | null;
  oneToOne: boolean;
}

export interface RateShape {
  hourlyRatePaise: number | null;
  perSessionPaise: number | null;
}

export interface PayoutMaths {
  sessions: number;
  minutes: number;
  ratePaise: number;
  rateBasis: 'HOUR' | 'SESSION';
  earnedPaise: number;
}

/** Whole minutes between two instants, never negative. */
export function sessionMinutes(startsAt: Date, endsAt: Date): number {
  return Math.max(0, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000));
}

export function computePayout(lines: PayoutLine[], rate: RateShape): PayoutMaths {
  const sessions = lines.length;
  const minutes = lines.reduce((n, l) => n + l.minutes, 0);
  if (rate.perSessionPaise && rate.perSessionPaise > 0) {
    return { sessions, minutes, ratePaise: rate.perSessionPaise, rateBasis: 'SESSION', earnedPaise: sessions * rate.perSessionPaise };
  }
  const hourly = rate.hourlyRatePaise ?? 0;
  return { sessions, minutes, ratePaise: hourly, rateBasis: 'HOUR', earnedPaise: Math.round((minutes * hourly) / 60) };
}

/** The month a period key names, on the academy's clock: "2026-09" as [from, to), `to` being the next month's first instant. */
export function monthWindow(key: string, timeZone: string): { from: Date; to: Date; label: string } | null {
  if (!/^\d{4}-\d{2}$/.test(key)) return null;
  const first = `${key}-01`;
  const from = dayStart(first, timeZone);
  const to = dayStart(addMonths(first, 1), timeZone);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const label = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone }).format(from);
  return { from, to, label };
}

/** The month key for "now" on the academy clock, and the one before it. */
export function recentMonthKeys(now: Date, timeZone: string, count = 6): string[] {
  const today = dayKey(now, timeZone);
  const out: string[] = [];
  let key = `${today.slice(0, 7)}-01`;
  for (let i = 0; i < count; i += 1) {
    out.push(key.slice(0, 7));
    key = addMonths(key, -1);
  }
  return out;
}

export function adjustmentProblem(paise: number, note: string): string | null {
  if (!Number.isFinite(paise)) return 'The adjustment is not a number.';
  if (paise !== 0 && note.trim().length < 3) return 'Say what the adjustment is for.';
  if (Math.abs(paise) > 10_000_000_00) return 'That adjustment looks wrong.';
  return null;
}

export const PAYOUT_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Drawn up',
  APPROVED: 'Approved',
  PAID: 'Paid',
};

/** Minutes as "12h 30m". */
export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
