import Link from 'next/link';
import { Badge, Card, EmptyState } from '@/components/ui';
import { WEEKDAY_LABELS, formatDayLabel, formatTime, minutesOfDay } from '@/lib/clock';

export interface CalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** The local day it belongs to, decided in the academy's timezone. */
  day: string;
  status: string;
  isHoliday: boolean;
  batchName: string;
  trainer: string | null;
  signedIn: number;
  roster: number;
}

function tone(e: CalendarEvent) {
  if (e.isHoliday) return { bg: 'var(--warn-soft)', fg: 'var(--warn)' };
  if (e.status === 'CANCELLED') return { bg: 'var(--bad-soft)', fg: 'var(--bad)' };
  if (e.status === 'LIVE') return { bg: 'var(--brand-soft)', fg: 'var(--brand)' };
  return { bg: 'var(--surface-2)', fg: 'var(--ink-2)' };
}

function byDay(events: CalendarEvent[]) {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = map.get(e.day);
    if (list) list.push(e);
    else map.set(e.day, [e]);
  }
  return map;
}

/* Month --------------------------------------------------------------------- */

export function MonthView({
  days,
  anchor,
  today,
  events,
}: {
  days: string[];
  anchor: string;
  today: string;
  events: CalendarEvent[];
}) {
  const map = byDay(events);
  const month = anchor.slice(0, 7);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[52rem] overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)] shadow-sm">
        <div className="grid grid-cols-7 border-b bg-[var(--surface-2)]">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="t-micro faint px-2 py-2 text-center font-semibold">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const items = map.get(day) ?? [];
            const outside = !day.startsWith(month);
            const isToday = day === today;

            return (
              <div
                key={day}
                className={`min-h-28 border-b border-r p-1.5 last:border-r-0 ${
                  outside ? 'bg-[var(--surface-2)]/40' : ''
                }`}
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <span
                    className={`t-micro tabular-nums ${
                      isToday
                        ? 'grid h-5 w-5 place-items-center rounded-full bg-[var(--brand)] font-semibold text-[var(--brand-ink)]'
                        : outside
                          ? 'faint'
                          : 'muted'
                    }`}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {items.length > 3 && (
                    <span className="t-micro faint">{items.length}</span>
                  )}
                </div>

                <ul className="space-y-1">
                  {items.slice(0, 3).map((e) => {
                    const c = tone(e);
                    return (
                      <li key={e.id}>
                        <Link
                          href={`/admin/sessions/${e.id}`}
                          title={`${e.title} · ${e.batchName}`}
                          className="block truncate rounded-[var(--radius-sm)] px-1.5 py-1 text-[0.6875rem] leading-tight hover:brightness-95"
                          style={{ background: c.bg, color: c.fg }}
                        >
                          {e.title}
                        </Link>
                      </li>
                    );
                  })}
                  {items.length > 3 && (
                    <li>
                      <Link
                        href={`/admin/calendar?view=day&date=${day}`}
                        className="t-micro faint block px-1.5 hover:underline"
                      >
                        {items.length - 3} more
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* Week and day -------------------------------------------------------------- */

const GRID_START = 6 * 60; // 06:00
const GRID_END = 23 * 60; // 23:00
const PIXELS_PER_MINUTE = 0.9;

/**
 * A real timetable rather than seven lists.
 *
 * Where a class sits vertically is the whole point: a trainer reads a gap the
 * way they read a sentence, and a list of times makes them do that arithmetic
 * in their head. The grid stretches only as far as the day actually runs.
 */
export function TimeGridView({
  days,
  today,
  events,
  timeZone,
}: {
  days: string[];
  today: string;
  events: CalendarEvent[];
  timeZone: string;
}) {
  const map = byDay(events);

  const starts = events.map((e) => minutesOfDay(new Date(e.startsAt), timeZone));
  const ends = events.map((e) => minutesOfDay(new Date(e.endsAt), timeZone));
  const from = Math.max(0, Math.min(GRID_START, ...(starts.length ? starts : [GRID_START])) - 30);
  const to = Math.min(24 * 60, Math.max(GRID_END, ...(ends.length ? ends : [GRID_END])) + 30);

  const height = (to - from) * PIXELS_PER_MINUTE;
  const hours = Array.from(
    { length: Math.ceil((to - from) / 60) + 1 },
    (_, i) => Math.floor(from / 60) * 60 + i * 60,
  ).filter((m) => m >= from && m <= to);

  return (
    <div className="overflow-x-auto">
      <div
        className={`${days.length > 1 ? 'min-w-[52rem]' : ''} overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)] shadow-sm`}
      >
        <div
          className="grid border-b bg-[var(--surface-2)]"
          style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div />
          {days.map((day) => (
            <div key={day} className="px-2 py-2 text-center">
              <p className={`t-micro ${day === today ? 'font-semibold text-[var(--brand)]' : 'faint'}`}>
                {formatDayLabel(day, timeZone)}
              </p>
              <p className="t-micro faint">{(map.get(day) ?? []).length || '—'}</p>
            </div>
          ))}
        </div>

        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))`,
            height: `${height}px`,
          }}
        >
          <div className="relative border-r">
            {hours.map((m) => (
              <span
                key={m}
                className="t-micro faint absolute right-2 -translate-y-1/2 tabular-nums"
                style={{ top: `${(m - from) * PIXELS_PER_MINUTE}px` }}
              >
                {String(Math.floor(m / 60)).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          {days.map((day) => (
            <div key={day} className="relative border-r last:border-r-0">
              {hours.map((m) => (
                <div
                  key={m}
                  className="absolute inset-x-0 border-t border-[var(--line)]"
                  style={{ top: `${(m - from) * PIXELS_PER_MINUTE}px` }}
                />
              ))}

              {(map.get(day) ?? []).map((e) => {
                const start = minutesOfDay(new Date(e.startsAt), timeZone);
                const end = Math.max(start + 20, minutesOfDay(new Date(e.endsAt), timeZone));
                const c = tone(e);

                return (
                  <Link
                    key={e.id}
                    href={`/admin/sessions/${e.id}`}
                    className="absolute inset-x-1 overflow-hidden rounded-[var(--radius-sm)] px-2 py-1 transition hover:brightness-95"
                    style={{
                      top: `${(start - from) * PIXELS_PER_MINUTE}px`,
                      height: `${(end - start) * PIXELS_PER_MINUTE}px`,
                      background: c.bg,
                      color: c.fg,
                    }}
                  >
                    <span className="block truncate text-[0.6875rem] font-semibold leading-tight">
                      {e.title}
                    </span>
                    <span className="block truncate text-[0.625rem] leading-tight opacity-80">
                      {formatTime(new Date(e.startsAt), timeZone)} · {e.batchName}
                    </span>
                    {e.status === 'CANCELLED' && (
                      <span className="block text-[0.625rem] font-semibold uppercase tracking-wide">
                        {e.isHoliday ? 'holiday' : 'cancelled'}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* List ---------------------------------------------------------------------- */

export function ListView({
  days,
  events,
  timeZone,
}: {
  days: string[];
  events: CalendarEvent[];
  timeZone: string;
}) {
  const map = byDay(events);
  const withSomething = days.filter((d) => (map.get(d) ?? []).length > 0);

  if (withSomething.length === 0) {
    return (
      <EmptyState
        title="Nothing scheduled in the next thirty days"
        hint="Schedule classes from the Sessions page, and they will appear here."
      />
    );
  }

  return (
    <Card padded={false}>
      {withSomething.map((day) => (
        <div key={day}>
          <p className="t-micro faint border-b bg-[var(--surface-2)] px-5 py-1.5 font-semibold uppercase tracking-wide">
            {formatDayLabel(day, timeZone, true)}
          </p>
          <ul className="divide-y">
            {(map.get(day) ?? []).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-4 px-5 py-2.5">
                <span className="t-small w-20 shrink-0 tabular-nums">
                  {formatTime(new Date(e.startsAt), timeZone)}
                </span>
                <span className="min-w-0 flex-1">
                  <Link href={`/admin/sessions/${e.id}`} className="text-sm font-medium hover:underline">
                    {e.title}
                  </Link>
                  <span className="t-micro faint block truncate">
                    {e.batchName}
                    {e.trainer ? ` · ${e.trainer}` : ''}
                  </span>
                </span>
                {e.isHoliday && <Badge tone="warn">holiday</Badge>}
                {!e.isHoliday && e.status === 'CANCELLED' && <Badge tone="bad">cancelled</Badge>}
                <span className="t-small faint w-24 shrink-0 text-right tabular-nums">
                  {new Date(e.startsAt) <= new Date() && e.status !== 'CANCELLED'
                    ? `${e.signedIn} of ${e.roster} in`
                    : `${e.roster} on the roll`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}
