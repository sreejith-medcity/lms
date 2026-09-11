import { addDays, dayKey, dayStart, weekdayOf } from '@/lib/clock';

/**
 * When a trainer can actually be booked.
 *
 * A trainer describes their week once, in local time: Tuesdays and Thursdays,
 * six to nine in the evening, half hour slots. Everything else is subtraction.
 * Take the pattern, remove the days they are away, remove the times they are
 * already teaching, remove anything too soon to arrange, and what is left is
 * offered to the learner.
 *
 * Two things make this worth being careful about. The pattern is in the
 * academy's local time and the classes are instants, so a trainer free from
 * six on Tuesdays is free from six in Kochi whatever the server thinks the
 * time is, and stays free from six through a daylight change somewhere else
 * in the world. And an overlap check that is even slightly wrong double-books
 * a human being, which is not a bug anybody can paper over afterwards.
 *
 * Pure: dates and numbers in, slots out, no database and no clock of its own.
 */

export interface WeeklyWindow {
  /** 0 is Sunday, matching the clock helpers and Date.getDay. */
  weekday: number;
  startMinute: number;
  endMinute: number;
  /** The size of one bookable slot inside the window. */
  slotMinutes: number;
  isActive?: boolean;
  validFrom?: Date | null;
  validUntil?: Date | null;
}

export interface Busy {
  startsAt: Date;
  endsAt: Date;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

/** Two periods overlap when each starts before the other ends. */
export function overlaps(a: Busy, b: Busy): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export function bookableSlots(input: {
  availability: WeeklyWindow[];
  /** Days or hours the trainer is away. */
  blackouts: Busy[];
  /** Classes already in the diary, one-to-one or batch. */
  busy: Busy[];
  /** How long this booking needs. */
  durationMinutes: number;
  timeZone: string;
  /** The first and last instant a learner may book into. */
  from: Date;
  to: Date;
  /** How much warning a booking needs. */
  minNoticeHours?: number;
  now?: Date;
  /** Stop after this many, so a wide window cannot produce thousands. */
  limit?: number;
}): Slot[] {
  const now = input.now ?? new Date();
  const notice = Math.max(0, input.minNoticeHours ?? 0) * 3_600_000;
  const earliest = new Date(Math.max(input.from.getTime(), now.getTime() + notice));
  const duration = Math.max(5, Math.round(input.durationMinutes)) * 60_000;
  const limit = input.limit ?? 500;

  if (earliest >= input.to) return [];

  const windows = input.availability.filter((w) => w.isActive !== false);
  if (windows.length === 0) return [];

  const slots: Slot[] = [];
  let key = dayKey(earliest, input.timeZone);
  const lastKey = dayKey(input.to, input.timeZone);

  // Day by day in the academy's own calendar, so a window on Tuesday is a
  // Tuesday there rather than wherever this is running.
  for (let guard = 0; guard < 400; guard += 1) {
    const weekday = weekdayOf(key);
    const midnight = dayStart(key, input.timeZone).getTime();

    for (const window of windows) {
      if (window.weekday !== weekday) continue;
      if (window.validFrom && midnight < window.validFrom.getTime()) continue;
      if (window.validUntil && midnight > window.validUntil.getTime()) continue;

      const step = Math.max(5, Math.round(window.slotMinutes)) * 60_000;
      const windowStart = midnight + Math.max(0, window.startMinute) * 60_000;
      const windowEnd = midnight + Math.max(0, window.endMinute) * 60_000;

      for (let at = windowStart; at + duration <= windowEnd; at += step) {
        const slot = { startsAt: new Date(at), endsAt: new Date(at + duration) };

        if (slot.startsAt < earliest) continue;
        if (slot.endsAt > input.to) continue;
        if (input.blackouts.some((b) => overlaps(slot, b))) continue;
        if (input.busy.some((b) => overlaps(slot, b))) continue;

        slots.push(slot);
        if (slots.length >= limit) return sortSlots(slots);
      }
    }

    if (key === lastKey) break;
    key = addDays(key, 1);
  }

  return sortSlots(slots);
}

function sortSlots(slots: Slot[]): Slot[] {
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * Is this exact slot still free?
 *
 * Asked again at the moment of booking, because the list a learner is looking
 * at was true when the page rendered and two people can be looking at the
 * same one. The list is a convenience; this is the check that decides.
 */
export function slotStillFree(input: {
  slot: Slot;
  availability: WeeklyWindow[];
  blackouts: Busy[];
  busy: Busy[];
  timeZone: string;
  minNoticeHours?: number;
  now?: Date;
}): { ok: boolean; reason?: 'TOO_SOON' | 'OUTSIDE_HOURS' | 'TAKEN' | 'AWAY' } {
  const now = input.now ?? new Date();
  const notice = Math.max(0, input.minNoticeHours ?? 0) * 3_600_000;

  if (input.slot.startsAt.getTime() - now.getTime() < notice) return { ok: false, reason: 'TOO_SOON' };
  if (input.blackouts.some((b) => overlaps(input.slot, b))) return { ok: false, reason: 'AWAY' };
  if (input.busy.some((b) => overlaps(input.slot, b))) return { ok: false, reason: 'TAKEN' };

  const key = dayKey(input.slot.startsAt, input.timeZone);
  const midnight = dayStart(key, input.timeZone).getTime();
  const weekday = weekdayOf(key);

  const inside = input.availability.some((w) => {
    if (w.isActive === false) return false;
    if (w.weekday !== weekday) return false;
    const start = midnight + w.startMinute * 60_000;
    const end = midnight + w.endMinute * 60_000;
    return input.slot.startsAt.getTime() >= start && input.slot.endsAt.getTime() <= end;
  });

  return inside ? { ok: true } : { ok: false, reason: 'OUTSIDE_HOURS' };
}

/** Sessions left on a credit: bought, minus booked, never below zero. */
export function creditsLeft(input: {
  sessionsTotal: number;
  /** Sessions booked against it that have not been cancelled. */
  bookedCount: number;
  expiresAt?: Date | null;
  now?: Date;
}): { left: number; expired: boolean } {
  const now = input.now ?? new Date();
  const expired = Boolean(input.expiresAt && now > input.expiresAt);
  return {
    left: Math.max(0, Math.max(0, input.sessionsTotal) - Math.max(0, input.bookedCount)),
    expired,
  };
}
