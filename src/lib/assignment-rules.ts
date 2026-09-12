/**
 * The rules of homework, with no database in them.
 *
 * Whether a learner may hand in, whether it counts as late, whether the
 * brief asks for words or a file or both, and what a trainer may write as
 * a mark. Decided here so the learner's page, the server action and the
 * tests all agree, and so a change to "can they hand in twice" is one
 * line in one place.
 */

export type AssignmentStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED';
export type HandInStatus = 'SUBMITTED' | 'GRADED' | 'RETURNED';

export interface AssignmentRules {
  status: AssignmentStatus;
  dueAt: Date | null;
  acceptLate: boolean;
  allowResubmit: boolean;
  requireText: boolean;
  requireFile: boolean;
  maxMarks: number;
}

export interface PriorHandIn {
  attemptNo: number;
  status: HandInStatus;
}

export type HandInDecision =
  | { allowed: true; attemptNo: number; late: boolean; again: boolean }
  | { allowed: false; reason: string };

/** Whether this learner may hand in now, and as which attempt. */
export function handInDecision(rules: AssignmentRules, prior: PriorHandIn[], now: Date = new Date()): HandInDecision {
  if (rules.status !== 'PUBLISHED') return { allowed: false, reason: 'This assignment is not open.' };

  const late = isLate(rules.dueAt, now);
  if (late && !rules.acceptLate) return { allowed: false, reason: 'The due date has passed and late work is not accepted.' };

  const latest = latestOf(prior);
  if (latest) {
    if (latest.status === 'GRADED' && !rules.allowResubmit) {
      return { allowed: false, reason: 'This has been marked and a second hand-in is not allowed.' };
    }
    if (latest.status === 'SUBMITTED' && !rules.allowResubmit) {
      return { allowed: false, reason: 'You have already handed this in. It is waiting to be marked.' };
    }
  }

  return { allowed: true, attemptNo: (latest?.attemptNo ?? 0) + 1, late, again: Boolean(latest) };
}

export function isLate(dueAt: Date | null, now: Date = new Date()): boolean {
  return Boolean(dueAt && now.getTime() > dueAt.getTime());
}

export function latestOf<T extends PriorHandIn>(prior: T[]): T | null {
  return prior.reduce<T | null>((best, p) => (best && best.attemptNo >= p.attemptNo ? best : p), null);
}

/** What is wrong with a hand-in, or null when it is complete enough to take. */
export function handInProblem(rules: Pick<AssignmentRules, 'requireText' | 'requireFile'>, handIn: { text: string; fileCount: number }): string | null {
  const words = handIn.text.trim().length > 0;
  if (rules.requireText && !words) return 'This assignment asks for a written answer.';
  if (rules.requireFile && handIn.fileCount === 0) return 'This assignment asks for a file.';
  if (!words && handIn.fileCount === 0) return 'Write something or attach a file before handing in.';
  return null;
}

/** A mark a trainer typed, checked against the assignment's total. */
export function gradeProblem(marks: number | null, maxMarks: number): string | null {
  if (marks === null || Number.isNaN(marks)) return 'Enter a mark.';
  if (marks < 0) return 'A mark cannot be negative.';
  if (marks > maxMarks) return `The most this assignment is out of is ${trimNumber(maxMarks)}.`;
  return null;
}

export function marksPercent(marks: number, maxMarks: number): number {
  if (maxMarks <= 0) return 0;
  return Math.round((marks / maxMarks) * 1000) / 10;
}

export function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * "Due in 3 days", "Due today", "Overdue by 2 days", or "No due date".
 * Whole days in the academy's calendar are the page's job; this counts
 * from now, which is what a learner glancing at a list actually wants.
 */
export function dueLabel(dueAt: Date | null, now: Date = new Date()): string {
  if (!dueAt) return 'No due date';
  const ms = dueAt.getTime() - now.getTime();
  const hours = ms / 3_600_000;
  if (hours >= 0) {
    if (hours < 1) return 'Due within the hour';
    if (hours < 24) return `Due in ${Math.floor(hours)} hour${Math.floor(hours) === 1 ? '' : 's'}`;
    const days = Math.floor(hours / 24);
    return `Due in ${days} day${days === 1 ? '' : 's'}`;
  }
  const overdueHours = -hours;
  if (overdueHours < 24) return 'Overdue since today';
  const days = Math.floor(overdueHours / 24);
  return `Overdue by ${days} day${days === 1 ? '' : 's'}`;
}

/** The learner's own view of where they stand with one assignment. */
export type LearnerStanding = 'NOT_STARTED' | 'WAITING' | 'GRADED' | 'RETURNED' | 'CLOSED';

export function learnerStanding(rules: AssignmentRules, prior: PriorHandIn[], now: Date = new Date()): LearnerStanding {
  const latest = latestOf(prior);
  if (latest?.status === 'GRADED') return 'GRADED';
  if (latest?.status === 'RETURNED') return 'RETURNED';
  if (latest?.status === 'SUBMITTED') return 'WAITING';
  if (rules.status !== 'PUBLISHED' || (isLate(rules.dueAt, now) && !rules.acceptLate)) return 'CLOSED';
  return 'NOT_STARTED';
}

/** Counts for a trainer's list: who handed in, who is waiting on them. */
export function handInTally(
  handIns: { userId: string; attemptNo: number; status: HandInStatus }[],
  enrolled: number,
): { handedIn: number; toMark: number; graded: number; returned: number; missing: number } {
  const latest = new Map<string, { attemptNo: number; status: HandInStatus }>();
  for (const h of handIns) {
    const cur = latest.get(h.userId);
    if (!cur || h.attemptNo > cur.attemptNo) latest.set(h.userId, h);
  }
  let toMark = 0;
  let graded = 0;
  let returned = 0;
  for (const h of latest.values()) {
    if (h.status === 'SUBMITTED') toMark += 1;
    else if (h.status === 'GRADED') graded += 1;
    else returned += 1;
  }
  const handedIn = latest.size;
  return { handedIn, toMark, graded, returned, missing: Math.max(0, enrolled - handedIn) };
}

export const HAND_IN_MAX_FILES = 5;
export const HAND_IN_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const HAND_IN_TEXT_MAX = 20_000;
export const BRIEF_MAX_FILES = 10;
