import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';

/**
 * Events: workshops, open days, webinars. Pure rules, no database, so the
 * public page, the app's API, checkout and the reminders all agree on when an
 * event is open, full, under way or over.
 */

/** An event with no end time is taken to run this long. */
export const DEFAULT_EVENT_MINUTES = 120;

/** The join link appears this long before an online event starts. */
export const JOIN_LEAD_MINUTES = 30;

export interface EventFacts {
  published: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  /** No cap when null or 0. */
  capacity: number | null;
  /** Places held now: registrations neither cancelled nor archived. */
  taken: number;
}

export type EventPhase = 'UPCOMING' | 'LIVE' | 'OVER';

export function eventEnd(e: Pick<EventFacts, 'startsAt' | 'endsAt'>): Date | null {
  if (e.endsAt) return e.endsAt;
  return e.startsAt ? new Date(e.startsAt.getTime() + DEFAULT_EVENT_MINUTES * 60_000) : null;
}

export function eventPhase(e: Pick<EventFacts, 'startsAt' | 'endsAt'>, now: Date): EventPhase {
  const end = eventEnd(e);
  if (end && now >= end) return 'OVER';
  if (e.startsAt && now >= e.startsAt) return 'LIVE';
  return 'UPCOMING';
}

export function seatsLeft(e: Pick<EventFacts, 'capacity' | 'taken'>): number | null {
  return e.capacity ? Math.max(0, e.capacity - e.taken) : null;
}

/**
 * Why somebody cannot register now, or null when they can. Registration stays
 * open while an event is under way, because people do join a webinar late.
 */
export function registrationProblem(e: EventFacts, now: Date): string | null {
  if (!e.published) return 'This event is not open for registration.';
  if (!e.startsAt) return 'This event has no date yet.';
  if (eventPhase(e, now) === 'OVER') return 'This event is over.';
  if (seatsLeft(e) === 0) return 'This event is full.';
  return null;
}

/** Whether a registered person should see the join link now. */
export function joinLinkOpen(e: Pick<EventFacts, 'startsAt' | 'endsAt'>, now: Date): boolean {
  if (!e.startsAt) return false;
  const end = eventEnd(e);
  return now.getTime() >= e.startsAt.getTime() - JOIN_LEAD_MINUTES * 60_000 && (!end || now < end);
}

/** "Sat 25 Oct, 10:00 am to 12:00 pm", or across days when it runs over midnight. */
export function eventWhen(startsAt: Date | null, endsAt: Date | null, timeZone: string): string {
  if (!startsAt) return 'Date to be announced';
  const startDay = dayKey(startsAt, timeZone);
  const start = `${formatDayLabel(startDay, timeZone)}, ${formatTime(startsAt, timeZone)}`;
  if (!endsAt) return start;
  const endDay = dayKey(endsAt, timeZone);
  if (endDay === startDay) return `${start} to ${formatTime(endsAt, timeZone)}`;
  return `${start} to ${formatDayLabel(endDay, timeZone)}, ${formatTime(endsAt, timeZone)}`;
}

/* Calendar file ------------------------------------------------------------ */

function icsStamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Commas, semicolons and backslashes escaped and newlines folded, as RFC 5545 asks. */
function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 octets are folded onto continuation lines. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function eventIcs(input: {
  uid: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  url: string;
  organizer: string;
  now?: Date;
}): string {
  const end = eventEnd(input) ?? input.startsAt;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${icsText(input.organizer)}//Events//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${icsStamp(input.now ?? new Date())}`,
    `DTSTART:${icsStamp(input.startsAt)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(input.title)}`,
    ...(input.location ? [`LOCATION:${icsText(input.location)}`] : []),
    `URL:${input.url}`,
    `DESCRIPTION:${icsText(`Details and joining: ${input.url}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
