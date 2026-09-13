import { createHmac, timingSafeEqual } from 'node:crypto';
import { dayKey } from '@/lib/clock';

/**
 * A learner's calendar: their classes, one-to-one lessons, homework due
 * dates and test windows, as one list of items a week view can draw and
 * an iCal feed can publish. Pure over the rows it is handed.
 */

export type AgendaKind = 'CLASS' | 'ONE_TO_ONE' | 'ASSIGNMENT_DUE' | 'ASSESSMENT_CLOSES' | 'HOLIDAY';

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  title: string;
  detail: string | null;
  startsAt: Date;
  endsAt: Date;
  /** All-day items (a due date) draw without a time. */
  allDay: boolean;
  /** The academy's local day, so an evening class lands on the right column. */
  day: string;
  url: string | null;
  joinUrl: string | null;
  status: 'SCHEDULED' | 'LIVE' | 'DONE' | 'CANCELLED';
}

export function groupByDay(items: AgendaItem[], days: string[]): Map<string, AgendaItem[]> {
  const map = new Map<string, AgendaItem[]>(days.map((d) => [d, []]));
  for (const it of [...items].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const list = map.get(it.day);
    if (list) list.push(it);
  }
  return map;
}

export function classItem(
  s: { id: string; title: string; startsAt: Date; endsAt: Date; status: string; isHoliday: boolean; joinUrl: string | null; batchName: string | null; learnerId: string | null },
  timeZone: string,
  now: Date = new Date(),
): AgendaItem {
  const cancelled = s.status === 'CANCELLED';
  const status = s.isHoliday ? 'CANCELLED' : cancelled ? 'CANCELLED' : s.status === 'LIVE' || (now >= s.startsAt && now <= s.endsAt) ? 'LIVE' : now > s.endsAt ? 'DONE' : 'SCHEDULED';
  return {
    id: `session:${s.id}`,
    kind: s.isHoliday ? 'HOLIDAY' : s.learnerId ? 'ONE_TO_ONE' : 'CLASS',
    title: s.title,
    detail: s.batchName,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    allDay: s.isHoliday,
    day: dayKey(s.startsAt, timeZone),
    url: '/learn',
    joinUrl: cancelled || s.isHoliday ? null : s.joinUrl,
    status,
  };
}

export function assignmentDueItem(a: { id: string; title: string; dueAt: Date; course: string }, timeZone: string): AgendaItem {
  return {
    id: `assignment:${a.id}`,
    kind: 'ASSIGNMENT_DUE',
    title: `Due: ${a.title}`,
    detail: a.course,
    startsAt: a.dueAt,
    endsAt: a.dueAt,
    allDay: false,
    day: dayKey(a.dueAt, timeZone),
    url: `/learn/assignments/${a.id}`,
    joinUrl: null,
    status: 'SCHEDULED',
  };
}

export function assessmentClosesItem(a: { id: string; title: string; closesAt: Date }, timeZone: string): AgendaItem {
  return {
    id: `assessment:${a.id}`,
    kind: 'ASSESSMENT_CLOSES',
    title: `Closes: ${a.title}`,
    detail: null,
    startsAt: a.closesAt,
    endsAt: a.closesAt,
    allDay: false,
    day: dayKey(a.closesAt, timeZone),
    url: `/learn/assessment/${a.id}`,
    joinUrl: null,
    status: 'SCHEDULED',
  };
}

/* The feed token ------------------------------------------------------------ */

/**
 * The address of a learner's calendar feed carries a token derived from
 * their id under the application secret, so the feed needs no sign-in
 * (phone calendars cannot sign in) and no row of its own. Rotating the
 * secret rotates every feed at once.
 */
export function calendarToken(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(`ical:${userId}`).digest('base64url').slice(0, 32);
}

export function calendarTokenMatches(userId: string, token: string, secret: string): boolean {
  const expected = Buffer.from(calendarToken(userId, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/* iCalendar ----------------------------------------------------------------- */

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 folds lines at 75 octets; most readers forgive longer, some do not. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 73) {
    let cut = 73;
    while (cut > 0 && Buffer.byteLength(rest.slice(0, cut)) > 73) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function toIcs(input: { name: string; items: AgendaItem[]; origin: string; timeZone: string }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${escape(input.name)}//Classes//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(input.name)}`,
    `X-WR-TIMEZONE:${input.timeZone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const it of input.items) {
    const url = it.joinUrl ?? (it.url ? `${input.origin}${it.url}` : null);
    const description = [it.detail, it.joinUrl ? `Join: ${it.joinUrl}` : null].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${it.id}@${new URL(input.origin || 'https://lms.invalid').hostname}`);
    lines.push(`DTSTAMP:${icsDate(new Date())}`);
    if (it.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${it.day.replace(/-/g, '')}`);
    } else {
      lines.push(`DTSTART:${icsDate(it.startsAt)}`);
      lines.push(`DTEND:${icsDate(it.endsAt.getTime() > it.startsAt.getTime() ? it.endsAt : new Date(it.startsAt.getTime() + 15 * 60_000))}`);
    }
    lines.push(`SUMMARY:${escape(it.title)}`);
    if (description) lines.push(`DESCRIPTION:${escape(description)}`);
    if (url) lines.push(`URL:${url}`);
    if (it.status === 'CANCELLED') lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
