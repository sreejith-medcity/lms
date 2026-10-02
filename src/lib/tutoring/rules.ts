import { addDays, weekdayOf } from '@/lib/clock';

/**
 * The rules of online tutoring, as arithmetic.
 *
 * A learner takes a course with an online tutor as a fixed number of
 * classes, at the same time on the same weekdays. A tutor marks the hours
 * they can teach; a learner asks for a start time; the tutor whose hours
 * cover that time on every class day, who has nothing else then and who
 * carries the least, gets them. A class called off (the tutor's leave, a
 * one-to-one learner's leave) is added to the end, so nobody loses a class
 * they paid for. Feedback is asked for after the 5th, 10th and 15th class
 * and at the end, both ways.
 *
 * Pure: days are YYYY-MM-DD strings on the academy's calendar, times are
 * minutes from midnight there, and nothing here reads a clock or a database.
 */

export interface Window {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface SlotShape {
  weekdays: number[];
  startMinute: number;
  minutes: number;
}

export const FEEDBACK_MILESTONES = [5, 10, 15] as const;
/** The feedback asked for when the last class has been held. */
export const FINAL_MILESTONE = 0;
export const TUTOR_LEAVE_CANCEL_DAYS = 7;
export const LEARNER_LEAVE_MAX_DAYS = 3;

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Calendar days in a leave, both ends included; 0 when the range is not a range. */
export function daysBetween(fromDay: string, toDay: string): number {
  if (!isDay(fromDay) || !isDay(toDay) || toDay < fromDay) return 0;
  const a = Date.UTC(Number(fromDay.slice(0, 4)), Number(fromDay.slice(5, 7)) - 1, Number(fromDay.slice(8, 10)));
  const b = Date.UTC(Number(toDay.slice(0, 4)), Number(toDay.slice(5, 7)) - 1, Number(toDay.slice(8, 10)));
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Do the tutor's marked hours cover this slot on every one of its weekdays? */
export function covers(windows: Window[], slot: SlotShape): boolean {
  const end = slot.startMinute + slot.minutes;
  if (slot.weekdays.length === 0 || slot.minutes <= 0 || end > 24 * 60) return false;
  return slot.weekdays.every((day) => windows.some((w) => w.weekday === day && w.startMinute <= slot.startMinute && w.endMinute >= end));
}

/** Two slots collide when they share a weekday and their times overlap. */
export function clashes(a: SlotShape, b: SlotShape): boolean {
  if (!a.weekdays.some((d) => b.weekdays.includes(d))) return false;
  return a.startMinute < b.startMinute + b.minutes && b.startMinute < a.startMinute + a.minutes;
}

export interface TutorState {
  userId: string;
  windows: Window[];
  /** The slots the tutor already teaches online. */
  taken: SlotShape[];
  /** Away for long from the day the learner would start: not offered new learners. */
  away?: boolean;
}

/** Could this tutor take this slot? */
export function free(tutor: TutorState, slot: SlotShape): boolean {
  if (tutor.away) return false;
  return covers(tutor.windows, slot) && !tutor.taken.some((t) => clashes(t, slot));
}

/**
 * The tutor for a slot: free then, and carrying the fewest groups, so the
 * work spreads rather than piling on whoever is first in the list. Ties go
 * to the id, so the same question always has the same answer.
 */
export function pickTutor(tutors: TutorState[], slot: SlotShape, except: string[] = []): string | null {
  const able = tutors.filter((t) => !except.includes(t.userId) && free(t, slot));
  if (!able.length) return null;
  able.sort((a, b) => a.taken.length - b.taken.length || a.userId.localeCompare(b.userId));
  return able[0].userId;
}

/** The start times a learner can be offered: those at least one tutor could take, in steps. */
export function openStartTimes(tutors: TutorState[], shape: { weekdays: number[]; minutes: number }, step = 30): number[] {
  const out: number[] = [];
  for (let at = 0; at + shape.minutes <= 24 * 60; at += step) {
    if (tutors.some((t) => free(t, { weekdays: shape.weekdays, startMinute: at, minutes: shape.minutes }))) out.push(at);
  }
  return out;
}

/** The first class day on or after a day. */
export function classDayOnOrAfter(day: string, weekdays: number[]): string | null {
  if (!isDay(day) || weekdays.length === 0) return null;
  let key = day;
  for (let i = 0; i < 8; i += 1) {
    if (weekdays.includes(weekdayOf(key))) return key;
    key = addDays(key, 1);
  }
  return null;
}

/** The next `count` class days from a day (that day included when it is one), skipping the days named. */
export function classDays(fromDay: string, weekdays: number[], count: number, skip: (day: string) => boolean = () => false): string[] {
  const out: string[] = [];
  if (!isDay(fromDay) || weekdays.length === 0) return out;
  let key = fromDay;
  for (let guard = 0; guard < count * 14 + 400 && out.length < count; guard += 1) {
    if (weekdays.includes(weekdayOf(key)) && !skip(key)) out.push(key);
    key = addDays(key, 1);
  }
  return out;
}

/** A tutor's leave: short, the classes are called off and made up; long, the groups go to someone else. */
export function tutorLeavePlan(fromDay: string, toDay: string): 'CANCEL' | 'REASSIGN' | null {
  const days = daysBetween(fromDay, toDay);
  if (days === 0) return null;
  return days > TUTOR_LEAVE_CANCEL_DAYS ? 'REASSIGN' : 'CANCEL';
}

/** Why a learner's leave cannot be taken as asked, or null when it can. */
export function learnerLeaveProblem(fromDay: string, toDay: string, today: string, maxDays = LEARNER_LEAVE_MAX_DAYS): string | null {
  const days = daysBetween(fromDay, toDay);
  if (days === 0) return 'Choose the first and the last day of the leave.';
  if (fromDay < today) return 'Leave starts today or later.';
  if (days > maxDays) return `Leave is up to ${maxDays} days at a time. For longer, talk to the office.`;
  return null;
}

/** Why a tutor's leave cannot be asked for as written, or null. */
export function tutorLeaveProblem(fromDay: string, toDay: string, today: string): string | null {
  const days = daysBetween(fromDay, toDay);
  if (days === 0) return 'Choose the first and the last day of the leave.';
  if (toDay < today) return 'That leave is already over.';
  if (days > 180) return 'That is more than six months. Talk to the office.';
  return null;
}

/** Which feedback is now due: the milestones reached that have not been asked for yet. */
export function milestonesDue(classesHeld: number, classesTotal: number, alreadyAsked: number[]): number[] {
  const due: number[] = [];
  for (const m of FEEDBACK_MILESTONES) {
    /* A milestone at or past the end is the final one's job. */
    if (m < classesTotal && classesHeld >= m && !alreadyAsked.includes(m)) due.push(m);
  }
  if (classesTotal > 0 && classesHeld >= classesTotal && !alreadyAsked.includes(FINAL_MILESTONE)) due.push(FINAL_MILESTONE);
  return due;
}

export function milestoneLabel(milestone: number): string {
  return milestone === FINAL_MILESTONE ? 'At the end of the course' : `After class ${milestone}`;
}

/** "7:30 pm" from minutes after midnight. */
export function timeLabel(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${suffix}`;
}

export function slotLabel(slot: SlotShape): string {
  return `${timeLabel(slot.startMinute)} to ${timeLabel(slot.startMinute + slot.minutes)}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Mon to Sat", "Mon, Wed, Fri". */
export function weekdaysLabel(weekdays: number[]): string {
  const days = [...new Set(weekdays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (days.length === 0) return 'no days';
  if (days.length === 7) return 'every day';
  const run = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (run && days.length >= 3) return `${DAY_NAMES[days[0]]} to ${DAY_NAMES[days[days.length - 1]]}`;
  return days.map((d) => DAY_NAMES[d]).join(', ');
}

/** "HH:MM" from a time field, as minutes; null when it is not a time. */
export function minuteOf(value: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

export function timeField(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** Hours for payroll: minutes as hours to two places. */
export function hoursOf(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** A learner's rating at or below this is put in front of the office. */
export const LOW_RATING = 2;
