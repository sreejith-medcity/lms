import type { ExamFormat, ExamSection } from '@/lib/exams/types';

/**
 * The clocks of a sitting.
 *
 * In exam mode the sections come in the format's order, each on its own
 * clock, and a section once finished (or run out) is closed for good,
 * exactly as on the day. A speaking section with preparation time has two
 * phases: preparation (the tasks, notes allowed, nothing recorded), then
 * the exam itself on a fresh clock. The clocks are the server's: a reload,
 * a second tab or a changed computer clock gives nobody a minute more.
 * In practice mode there are no clocks and the candidate goes where they
 * like. Pure: the data layer hands in the sitting and the time.
 */

export type Phase = 'prep' | 'exam';

export interface SectionClock {
  startedAt: string;
  phase: Phase;
  deadline: string;
}

export type Clocks = Record<string, SectionClock>;

export interface SittingClockState {
  mode: 'exam' | 'practice';
  /** A tutor's set part: only this section is sat. */
  onlySection: string | null;
  clocks: Clocks;
  done: string[];
}

/** Seconds a save is still taken after the clock reads zero: the last keystroke in flight, not extra time. */
export const GRACE_SECONDS = 20;

export function sectionOrder(format: ExamFormat, onlySection: string | null): string[] {
  const all = format.sections.map((s) => s.id);
  return onlySection && all.includes(onlySection) ? [onlySection] : all;
}

export function hasSpeaking(format: ExamFormat, sectionId: string): boolean {
  return format.blocks.some((b) => b.sectionId === sectionId && b.layout === 'speak');
}

function sectionOf(format: ExamFormat, id: string): ExamSection | undefined {
  return format.sections.find((s) => s.id === id);
}

/** Finished sections, counting any whose exam clock ran out (with grace) as finished. */
export function doneSections(format: ExamFormat, s: SittingClockState, now: Date): string[] {
  const done = new Set(s.done);
  if (s.mode === 'exam') {
    for (const [id, c] of Object.entries(s.clocks)) {
      if (c.phase === 'exam' && now.getTime() > new Date(c.deadline).getTime() + GRACE_SECONDS * 1000) done.add(id);
    }
  }
  return sectionOrder(format, s.onlySection).filter((id) => done.has(id));
}

/** The section the candidate is in or comes to next; null when every one is finished. */
export function currentSection(format: ExamFormat, s: SittingClockState, now: Date): string | null {
  const done = new Set(doneSections(format, s, now));
  return sectionOrder(format, s.onlySection).find((id) => !done.has(id)) ?? null;
}

export type SectionStatus = 'closed' | 'waiting' | 'prep' | 'open' | 'upcoming';

export function sectionStatus(format: ExamFormat, s: SittingClockState, sectionId: string, now: Date): SectionStatus {
  const order = sectionOrder(format, s.onlySection);
  if (!order.includes(sectionId)) return 'closed';
  if (doneSections(format, s, now).includes(sectionId)) return 'closed';
  if (s.mode === 'practice') return 'open';
  if (currentSection(format, s, now) !== sectionId) return 'upcoming';
  const c = s.clocks[sectionId];
  if (!c) return 'waiting';
  if (c.phase === 'prep') return 'prep';
  return 'open';
}

/** The clock a section starts with: preparation first when it has speaking and preparation time. */
export function startClock(format: ExamFormat, sectionId: string, now: Date): SectionClock {
  const sec = sectionOf(format, sectionId);
  if (!sec) throw new Error('UNKNOWN_SECTION');
  const prep = sec.preparationMinutes && hasSpeaking(format, sectionId) ? sec.preparationMinutes : 0;
  const minutes = prep || sec.minutes;
  return { startedAt: now.toISOString(), phase: prep ? 'prep' : 'exam', deadline: new Date(now.getTime() + minutes * 60_000).toISOString() };
}

/** Preparation over, early or on time: the same tasks, now recorded, on the section's own clock. */
export function endPreparation(format: ExamFormat, clock: SectionClock, sectionId: string, now: Date): SectionClock {
  if (clock.phase !== 'prep') return clock;
  const sec = sectionOf(format, sectionId);
  if (!sec) throw new Error('UNKNOWN_SECTION');
  /* Ending preparation after its time is up starts the exam from its deadline, not from whenever the button was pressed. */
  const from = Math.min(now.getTime(), new Date(clock.deadline).getTime());
  return { startedAt: clock.startedAt, phase: 'exam', deadline: new Date(from + sec.minutes * 60_000).toISOString() };
}

/** Whether an answer in this section is taken now: an open section, inside its clock plus grace. */
export function mayAnswer(format: ExamFormat, s: SittingClockState, sectionId: string, now: Date): boolean {
  const st = sectionStatus(format, s, sectionId, now);
  if (s.mode === 'practice') return st === 'open';
  if (st !== 'open') return false;
  const c = s.clocks[sectionId];
  return Boolean(c) && now.getTime() <= new Date(c.deadline).getTime() + GRACE_SECONDS * 1000;
}

/** Notes during preparation are the one thing written in the prep phase. */
export function mayTakeNotes(format: ExamFormat, s: SittingClockState, sectionId: string, now: Date): boolean {
  const st = sectionStatus(format, s, sectionId, now);
  return st === 'prep' || st === 'open';
}

/** Every section finished: the sitting can be handed in, or is handed in by the clock. */
export function allDone(format: ExamFormat, s: SittingClockState, now: Date): boolean {
  return currentSection(format, s, now) === null;
}

/** Seconds left on a section's current clock, never below zero; null without a clock. */
export function secondsLeft(clock: SectionClock | undefined, now: Date): number | null {
  if (!clock) return null;
  return Math.max(0, Math.floor((new Date(clock.deadline).getTime() - now.getTime()) / 1000));
}

/**
 * When an abandoned sitting stops being waited for: the last section's
 * clock could not have run past this, with every section taken at its
 * full time from the start. After it the sitting is closed and counted.
 */
export function latestEnd(format: ExamFormat, startedAt: Date, onlySection: string | null): Date {
  const minutes = sectionOrder(format, onlySection).reduce((a, id) => {
    const s = sectionOf(format, id);
    return a + (s ? s.minutes + (s.preparationMinutes ?? 0) : 0);
  }, 0);
  /* Plus a day: a candidate may start a section long after the last one ended. */
  return new Date(startedAt.getTime() + (minutes + 24 * 60) * 60_000);
}
