import { gradeFor, type Band } from '@/lib/grading';

/**
 * The rules of a mark sheet, with no database in them.
 *
 * A mark is bounded by the paper's maximum and never below zero. "Absent"
 * and "not assessed" are outcomes of their own and never a zero, because a
 * zero on a trend says the learner failed and an absence says nothing of
 * the kind. A grade and a pass come from the program's rules; a teacher
 * who disagrees writes an override with a reason rather than a
 * contradictory value.
 */

export type Outcome = 'SCORED' | 'ABSENT' | 'NOT_ASSESSED';
export type SheetStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'PUBLISHED';

export interface EntryInput {
  userId: string;
  outcome: Outcome;
  marks: number | null;
  remark: string | null;
  override: string | null;
}

export interface EntryComputed extends EntryInput {
  percent: number | null;
  grade: string | null;
  passed: boolean | null;
}

export interface SheetRules {
  maxMarks: number;
  passPercent: number | null;
  bands: Band[];
}

export function percentOf(marks: number, maxMarks: number): number {
  if (maxMarks <= 0) return 0;
  return Math.round((marks / maxMarks) * 1000) / 10;
}

/** What a line says once the rules are applied; null fields where nothing can be said. */
export function computeEntry(e: EntryInput, rules: SheetRules): EntryComputed {
  if (e.outcome !== 'SCORED' || e.marks === null) return { ...e, marks: e.outcome === 'SCORED' ? e.marks : null, percent: null, grade: null, passed: null };
  const percent = percentOf(e.marks, rules.maxMarks);
  const band = rules.bands.length ? gradeFor(percent, rules.bands) : null;
  const passed = rules.passPercent !== null ? percent >= rules.passPercent : band ? (band.point ?? 0) > 0 : null;
  return { ...e, percent, grade: band?.grade ?? null, passed };
}

/** Why a line cannot be submitted, or null. */
export function entryProblem(e: EntryInput, rules: SheetRules): string | null {
  if (e.outcome === 'SCORED') {
    if (e.marks === null || !Number.isFinite(e.marks)) return 'has no mark. Enter one, or mark them absent or not assessed.';
    if (e.marks < 0) return 'has a mark below zero.';
    if (e.marks > rules.maxMarks) return `has ${e.marks}, above the maximum of ${rules.maxMarks}.`;
    if (Math.round(e.marks * 100) !== e.marks * 100) return 'has a mark with more than two decimals.';
  }
  if (e.remark && e.remark.length > 500) return 'has a remark over 500 characters.';
  return null;
}

/** Parses what a phone's numeric keyboard typed. Blank is null, never zero. */
export function parseMark(raw: string): number | null | 'bad' {
  const v = raw.trim();
  if (v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return 'bad';
  return Math.round(n * 100) / 100;
}

export interface SheetReview {
  scored: number;
  absent: number;
  notAssessed: number;
  missing: string[];
  problems: string[];
  passed: number;
  average: number | null;
}

/** What the teacher reads before submitting and the Branch Head before approving. */
export function reviewSheet(roster: { userId: string; name: string }[], entries: EntryInput[], rules: SheetRules): SheetReview {
  const byUser = new Map(entries.map((e) => [e.userId, e]));
  const out: SheetReview = { scored: 0, absent: 0, notAssessed: 0, missing: [], problems: [], passed: 0, average: null };
  const percents: number[] = [];
  for (const r of roster) {
    const e = byUser.get(r.userId);
    if (!e) {
      out.missing.push(r.name);
      continue;
    }
    const problem = entryProblem(e, rules);
    if (problem) out.problems.push(`${r.name} ${problem}`);
    const c = computeEntry(e, rules);
    if (c.outcome === 'ABSENT') out.absent += 1;
    else if (c.outcome === 'NOT_ASSESSED' || c.percent === null) out.notAssessed += 1;
    else {
      out.scored += 1;
      percents.push(c.percent);
      if (c.passed) out.passed += 1;
    }
  }
  out.average = percents.length ? Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10 : null;
  return out;
}

/** Whether a sheet may move from one state to another, and by whom. */
export function canTransition(from: SheetStatus, to: SheetStatus, who: 'teacher' | 'approver'): boolean {
  if (who === 'teacher') return (from === 'DRAFT' || from === 'RETURNED') && to === 'SUBMITTED';
  if (who === 'approver') return from === 'SUBMITTED' && (to === 'PUBLISHED' || to === 'RETURNED');
  return false;
}

/** A sheet's entries may be edited only before submission or after a return. */
export function editable(status: SheetStatus): boolean {
  return status === 'DRAFT' || status === 'RETURNED';
}

export interface Diff {
  userId: string;
  name: string;
  before: string;
  after: string;
}

function describe(e: EntryComputed | undefined): string {
  if (!e) return 'no line';
  if (e.outcome === 'ABSENT') return 'absent';
  if (e.outcome === 'NOT_ASSESSED' || e.marks === null) return 'not assessed';
  return `${e.marks}${e.grade ? ` (${e.grade})` : ''}${e.passed === false ? ', fail' : ''}`;
}

/** What a correction changes against the version it replaces, for the approval screen. */
export function diffVersions(roster: { userId: string; name: string }[], before: EntryComputed[], after: EntryComputed[]): Diff[] {
  const b = new Map(before.map((e) => [e.userId, e]));
  const a = new Map(after.map((e) => [e.userId, e]));
  const out: Diff[] = [];
  for (const r of roster) {
    const x = describe(b.get(r.userId));
    const y = describe(a.get(r.userId));
    const rb = b.get(r.userId)?.remark ?? '';
    const ra = a.get(r.userId)?.remark ?? '';
    if (x !== y || rb !== ra) out.push({ userId: r.userId, name: r.name, before: rb ? `${x}; "${rb}"` : x, after: ra ? `${y}; "${ra}"` : y });
  }
  return out;
}

/** The statuses a parent may ever see. */
export function visibleToParents(status: SheetStatus, supersededById: string | null): boolean {
  return status === 'PUBLISHED' && supersededById === null;
}
