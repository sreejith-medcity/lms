/**
 * Calendar arithmetic in the academy's timezone, not the server's.
 *
 * A class at 7pm in Kochi belongs to that Tuesday whether the box running this
 * is in Mumbai, Frankfurt or UTC. Every other screen formats dates in whatever
 * the server happens to be set to, which is survivable for a list and wrong for
 * a calendar, where the entire question is which day something lands on.
 */

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asIfUtc - at.getTime();
}

/** The YYYY-MM-DD the instant falls on, in that zone. */
export function dayKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function todayKey(timeZone: string): string {
  return dayKey(new Date(), timeZone);
}

/** Midnight at the start of that local day, as a real instant. */
export function dayStart(key: string, timeZone: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0);
  // Two passes so a day that begins inside a DST shift still lands on midnight.
  const once = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(once), timeZone));
}

export function dayEnd(key: string, timeZone: string): Date {
  return dayStart(addDays(key, 1), timeZone);
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const at = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export function addMonths(key: string, months: number): string {
  const [y, m] = key.split('-').map(Number);
  const at = new Date(Date.UTC(y, (m ?? 1) - 1 + months, 1));
  return at.toISOString().slice(0, 10);
}

/** 0 = Sunday, matching Date.getDay and the WEEKDAYS table in server/sessions. */
export function weekdayOf(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** The Sunday on or before this day. */
export function weekStart(key: string): string {
  return addDays(key, -weekdayOf(key));
}

/** Six weeks from the Sunday before the 1st: a month grid that never reflows. */
export function monthGrid(key: string): string[] {
  const first = `${key.slice(0, 7)}-01`;
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function minutesOfDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return (get('hour') % 24) * 60 + get('minute');
}

export function formatTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

export function formatDayLabel(key: string, timeZone: string, long = false): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: long ? 'long' : 'short',
    day: 'numeric',
    month: long ? 'long' : 'short',
  }).format(dayStart(key, timeZone));
}

export function formatMonthLabel(key: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone, month: 'long', year: 'numeric' }).format(
    dayStart(`${key.slice(0, 7)}-01`, timeZone),
  );
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
