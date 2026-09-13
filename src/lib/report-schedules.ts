import { addDays, dayKey, dayStart } from '@/lib/clock';

/**
 * Scheduled reports: when the next one goes, on the academy's clock.
 *
 * Daily at an hour; weekly on a weekday at an hour; monthly on a day of
 * the month (1 to 28, so February never skips) at an hour. Computed in the
 * academy's timezone, which is what "Monday at 8" means to the person who
 * set it, wherever the server is.
 */

export type Cadence = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface ScheduleShape {
  cadence: Cadence | string;
  dayOfWeek: number;
  dayOfMonth: number;
  hourLocal: number;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** 1 (Monday) to 7 (Sunday) for a YYYY-MM-DD key. */
function isoWeekday(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday
  return js === 0 ? 7 : js;
}

function dayOfMonthOf(key: string): number {
  return Number(key.slice(8, 10));
}

/** The first instant at or after `from` when the schedule should run. */
export function nextRun(s: ScheduleShape, from: Date, timeZone: string): Date {
  const hour = Math.max(0, Math.min(23, Math.round(s.hourLocal)));
  let key = dayKey(from, timeZone);
  for (let i = 0; i < 400; i += 1) {
    const matches =
      s.cadence === 'DAILY' ||
      (s.cadence === 'WEEKLY' && isoWeekday(key) === Math.max(1, Math.min(7, s.dayOfWeek))) ||
      (s.cadence === 'MONTHLY' && dayOfMonthOf(key) === Math.max(1, Math.min(28, s.dayOfMonth)));
    if (matches) {
      const at = new Date(dayStart(key, timeZone).getTime() + hour * 3_600_000);
      if (at.getTime() > from.getTime()) return at;
    }
    key = addDays(key, 1);
  }
  return new Date(from.getTime() + 86_400_000);
}

export function describeCadence(s: ScheduleShape): string {
  const h = Math.max(0, Math.min(23, Math.round(s.hourLocal)));
  const clock = `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
  if (s.cadence === 'DAILY') return `Every day at ${clock}`;
  if (s.cadence === 'WEEKLY') return `Every ${WEEKDAYS[Math.max(1, Math.min(7, s.dayOfWeek)) - 1]} at ${clock}`;
  const d = Math.max(1, Math.min(28, s.dayOfMonth));
  const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
  return `On the ${d}${suffix} of every month at ${clock}`;
}

/** Emails, one per line or comma-separated, cleaned; the ones that are not emails come back as problems. */
export function parseRecipients(raw: string): { emails: string[]; problems: string[] } {
  const emails: string[] = [];
  const problems: string[] = [];
  for (const piece of raw.split(/[\n,;]+/)) {
    const e = piece.trim().toLowerCase();
    if (!e) continue;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      if (!emails.includes(e)) emails.push(e);
    } else problems.push(piece.trim());
  }
  return { emails: emails.slice(0, 20), problems };
}

export const RANGE_CHOICES = [7, 30, 90] as const;

export function rangeLabel(days: number): string {
  return days === 7 ? 'the last 7 days' : days === 90 ? 'the last 90 days' : 'the last 30 days';
}

/** The window a run covers, floored to the academy's day. */
export function windowFor(days: number, now: Date, timeZone: string): { since: Date; days: number } {
  const d = RANGE_CHOICES.includes(days as (typeof RANGE_CHOICES)[number]) ? days : 30;
  const since = dayStart(addDays(dayKey(now, timeZone), -(d - 1)), timeZone);
  return { since, days: d };
}

export function fileNameFor(reportId: string, at: Date, timeZone: string): string {
  return `${reportId}-${dayKey(at, timeZone)}.csv`;
}
