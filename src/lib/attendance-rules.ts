/**
 * The rules of the register, with no database in them.
 *
 * The one that matters most: a learner nobody marked is "not recorded", and
 * that is a state of its own. Turning silence into an absence is how a
 * parent gets a message about a class their child sat through, and nothing
 * here does it.
 */

export type Mark = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

export const MARKS: { value: Mark; label: string; short: string }[] = [
  { value: 'PRESENT', label: 'Present', short: 'P' },
  { value: 'ABSENT', label: 'Absent', short: 'A' },
  { value: 'LATE', label: 'Late', short: 'L' },
  { value: 'EXCUSED', label: 'Excused', short: 'E' },
];

export function isMark(v: unknown): v is Mark {
  return v === 'PRESENT' || v === 'ABSENT' || v === 'LATE' || v === 'EXCUSED';
}

/** A join this many minutes after the start is late. */
export function statusForJoin(minutesAfterStart: number, lateAfterMinutes: number): Mark {
  return minutesAfterStart > lateAfterMinutes ? 'LATE' : 'PRESENT';
}

export interface RosterEntry {
  userId: string;
  name: string;
  /** What is recorded already, if anything. */
  recorded: Mark | null;
}

export interface RegisterReview {
  present: number;
  absent: number;
  late: number;
  excused: number;
  unmarked: string[];
  total: number;
}

/** The counts a teacher reads before pressing submit; unmarked learners are named, not counted as absent. */
export function reviewRegister(roster: RosterEntry[], marks: Record<string, Mark | undefined>): RegisterReview {
  const out: RegisterReview = { present: 0, absent: 0, late: 0, excused: 0, unmarked: [], total: roster.length };
  for (const r of roster) {
    const m = marks[r.userId] ?? r.recorded;
    if (m === 'PRESENT') out.present += 1;
    else if (m === 'ABSENT') out.absent += 1;
    else if (m === 'LATE') out.late += 1;
    else if (m === 'EXCUSED') out.excused += 1;
    else out.unmarked.push(r.name);
  }
  return out;
}

/** Statuses a parent is told about at once. */
export function alerts(status: Mark | null): boolean {
  return status === 'ABSENT' || status === 'LATE';
}

/**
 * What a correction owes the parent: nothing when neither status was
 * alertable, a fresh alert when the new one is, and a correction notice
 * when an alert already went out for the old one. The notice covers both
 * "was absent, now present" and "was absent, now late".
 */
export function correctionNotice(from: Mark | null, to: Mark): 'none' | 'alert' | 'correction' {
  if (alerts(from)) return from === to ? 'none' : 'correction';
  if (alerts(to)) return 'alert';
  return 'none';
}

/** One key per learner, class and status event, so a re-save sends nothing twice. */
export function alertKey(sessionId: string, userId: string, status: Mark): string {
  return `attendance:${sessionId}:${userId}:${status}`;
}

/**
 * Whether this person may still correct this class's register. Inside the
 * window anybody with the permission may; after it, only somebody whose
 * scope is the branch or the academy.
 */
export function canCorrect(sessionStart: Date, now: Date, correctionDays: number, branchLevel: boolean): boolean {
  if (branchLevel) return true;
  const ageDays = (now.getTime() - sessionStart.getTime()) / 864e5;
  return ageDays <= correctionDays;
}

export interface NoShowInput {
  /** The platform confirmed the class started (a meeting.started event). */
  confirmedStarted: boolean;
  startsAt: Date;
  now: Date;
  absentAfterMinutes: number;
  /** Learners on the roll with no attendance row at all. */
  unrecorded: string[];
}

/**
 * Online no-shows: only after the platform has said the class is running,
 * only after the check time, and only for learners with no record. A class
 * the platform never reported is "awaiting attendance data", and this
 * returns nobody for it.
 */
export function onlineNoShows(input: NoShowInput): string[] {
  if (!input.confirmedStarted) return [];
  const checkAt = input.startsAt.getTime() + input.absentAfterMinutes * 60_000;
  if (input.now.getTime() < checkAt) return [];
  return input.unrecorded;
}

/** The state a register shows for an unrecorded learner in an online class. */
export function unrecordedState(input: { mode: 'IN_PERSON' | 'ONLINE' | 'HYBRID'; confirmedStarted: boolean; ended: boolean }): 'not recorded' | 'awaiting attendance data' | 'needs review' {
  if (input.mode === 'IN_PERSON') return 'not recorded';
  if (!input.confirmedStarted) return input.ended ? 'needs review' : 'awaiting attendance data';
  return input.ended ? 'needs review' : 'awaiting attendance data';
}

/** The sentence a parent receives. */
export function parentLine(input: { learner: string; status: Mark; title: string; when: string; corrected?: { from: Mark } }): { title: string; body: string } {
  const word = input.status === 'ABSENT' ? 'was absent from' : input.status === 'LATE' ? 'arrived late to' : input.status === 'EXCUSED' ? 'was excused from' : 'was present at';
  if (input.corrected) {
    const before = input.corrected.from === 'ABSENT' ? 'absent' : input.corrected.from === 'LATE' ? 'late' : input.corrected.from.toLowerCase();
    return {
      title: `Correction: ${input.learner}, ${input.title}`,
      body: `Earlier we said ${input.learner} was ${before} for ${input.title} on ${input.when}. That has been corrected: ${input.learner} ${word} the class.`,
    };
  }
  return {
    title: `${input.learner} ${input.status === 'ABSENT' ? 'was absent' : 'arrived late'}: ${input.title}`,
    body: `${input.learner} ${word} ${input.title} on ${input.when}. If this is unexpected, please speak to the branch.`,
  };
}
