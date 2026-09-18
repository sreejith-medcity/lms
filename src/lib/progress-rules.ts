/**
 * How a learner's progress is worked out, with no database in it.
 *
 * Every figure here says what it counts, because the parent's screen
 * prints the basis beside the number. Missing records, pending approval
 * and unassessed work are never zero: they are counted apart and named.
 */

export type Mark = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
export type RetestRule = 'FIRST' | 'LATEST' | 'BEST';

export interface AttendanceInput {
  /** Every completed class on the roll in the period. */
  sessions: { id: string; startsAt: Date; status: Mark | null }[];
}

export interface AttendanceFigure {
  held: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Classes with no final record: not counted either way. */
  notRecorded: number;
  /** Present and late over held less excused and not recorded; null when nothing counts. */
  percent: number | null;
  basis: string;
}

export function attendanceFigure(input: AttendanceInput): AttendanceFigure {
  const f: AttendanceFigure = { held: input.sessions.length, present: 0, late: 0, absent: 0, excused: 0, notRecorded: 0, percent: null, basis: '' };
  for (const s of input.sessions) {
    if (s.status === 'PRESENT') f.present += 1;
    else if (s.status === 'LATE') f.late += 1;
    else if (s.status === 'ABSENT') f.absent += 1;
    else if (s.status === 'EXCUSED') f.excused += 1;
    else f.notRecorded += 1;
  }
  const counted = f.held - f.excused - f.notRecorded;
  f.percent = counted > 0 ? Math.round(((f.present + f.late) / counted) * 100) : null;
  f.basis = `Present and late over ${counted} completed class${counted === 1 ? '' : 'es'} with a final record${f.excused ? `; ${f.excused} excused not counted` : ''}${f.notRecorded ? `; ${f.notRecorded} not recorded, not counted` : ''}.`;
  return f;
}

export interface Result {
  sheetId: string;
  /** The key that says two results are attempts at the same thing. */
  seriesKey: string;
  title: string;
  category: string;
  skill: string | null;
  level: string | null;
  testDate: Date;
  percent: number | null;
  passed: boolean | null;
  grade: string | null;
  outcome: 'SCORED' | 'ABSENT' | 'NOT_ASSESSED';
  remark: string | null;
  version: number;
}

/**
 * Which attempt at the same test counts on the trend. Two published
 * sheets for the same title in the same batch are retests; the program's
 * rule picks one and the others are labelled as retests rather than
 * dropped.
 */
export function applyRetestRule(results: Result[], rule: RetestRule): { counted: Result[]; retests: Result[] } {
  const groups = new Map<string, Result[]>();
  for (const r of results) groups.set(r.seriesKey, [...(groups.get(r.seriesKey) ?? []), r]);
  const counted: Result[] = [];
  const retests: Result[] = [];
  for (const group of groups.values()) {
    const scored = group.filter((g) => g.outcome === 'SCORED' && g.percent !== null).sort((a, b) => a.testDate.getTime() - b.testDate.getTime());
    if (scored.length <= 1) {
      counted.push(...group);
      continue;
    }
    let pick: Result;
    if (rule === 'FIRST') pick = scored[0];
    else if (rule === 'BEST') pick = scored.reduce((best, r) => ((r.percent ?? -1) > (best.percent ?? -1) ? r : best), scored[0]);
    else pick = scored[scored.length - 1];
    counted.push(pick);
    for (const g of group) if (g !== pick) retests.push(g);
  }
  return { counted: counted.sort((a, b) => a.testDate.getTime() - b.testDate.getTime()), retests };
}

export interface Trend {
  label: string;
  points: { date: Date; percent: number; title: string; grade: string | null; passed: boolean | null }[];
  average: number | null;
  basis: string;
}

/** Published scores over time, one trend per kind of test and skill, so like compares with like. */
export function trends(results: Result[], rule: RetestRule): Trend[] {
  const { counted } = applyRetestRule(results, rule);
  const groups = new Map<string, Result[]>();
  for (const r of counted) {
    if (r.outcome !== 'SCORED' || r.percent === null) continue;
    const label = r.skill ? `${r.category} · ${r.skill}` : r.category;
    groups.set(label, [...(groups.get(label) ?? []), r]);
  }
  const ruleWord = rule === 'FIRST' ? 'first' : rule === 'BEST' ? 'best' : 'latest';
  return [...groups.entries()].map(([label, rs]) => {
    const points = rs.map((r) => ({ date: r.testDate, percent: r.percent as number, title: r.title, grade: r.grade, passed: r.passed }));
    const average = Math.round((points.reduce((n, p) => n + p.percent, 0) / points.length) * 10) / 10;
    return { label, points, average, basis: `${points.length} published result${points.length === 1 ? '' : 's'}; the ${ruleWord} attempt counts when a test was sat again; absent and not assessed are left out.` };
  });
}

export interface HomeworkInput {
  /** Every published homework due in the period, with the learner's latest state. */
  items: { title: string; dueAt: Date | null; verification: 'COMPLETE' | 'INCOMPLETE' | 'RESUBMIT' | null; handedIn: boolean; feedback: string | null }[];
}

export interface HomeworkFigure {
  due: number;
  complete: number;
  incomplete: number;
  resubmit: number;
  awaiting: number;
  notSubmitted: number;
  basis: string;
}

export function homeworkFigure(input: HomeworkInput): HomeworkFigure {
  const f: HomeworkFigure = { due: input.items.length, complete: 0, incomplete: 0, resubmit: 0, awaiting: 0, notSubmitted: 0, basis: '' };
  for (const i of input.items) {
    if (!i.handedIn) f.notSubmitted += 1;
    else if (i.verification === 'COMPLETE') f.complete += 1;
    else if (i.verification === 'INCOMPLETE') f.incomplete += 1;
    else if (i.verification === 'RESUBMIT') f.resubmit += 1;
    else f.awaiting += 1;
  }
  f.basis = `Verified complete out of ${f.due} homework due in the period${f.awaiting ? `; ${f.awaiting} handed in and awaiting verification, shown apart` : ''}.`;
  return f;
}

export interface Rubric {
  /** Weights that add to 100. */
  attendance: number;
  tests: number;
  homework: number;
  /** Ascending bands: the label a total earns from this percent up. */
  bands: { label: string; minPercent: number }[];
}

export function parseRubric(raw: unknown): Rubric | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const attendance = Number(r.attendance);
  const tests = Number(r.tests);
  const homework = Number(r.homework);
  if (![attendance, tests, homework].every((n) => Number.isFinite(n) && n >= 0)) return null;
  if (Math.round(attendance + tests + homework) !== 100) return null;
  const bands = Array.isArray(r.bands)
    ? r.bands
        .map((b) => (b && typeof b === 'object' ? { label: String((b as Record<string, unknown>).label ?? '').trim(), minPercent: Number((b as Record<string, unknown>).minPercent) } : null))
        .filter((b): b is { label: string; minPercent: number } => Boolean(b && b.label && Number.isFinite(b.minPercent)))
        .sort((a, b) => a.minPercent - b.minPercent)
    : [];
  if (bands.length === 0) return null;
  return { attendance, tests, homework, bands };
}

export interface RatingInput {
  attendancePercent: number | null;
  testsAverage: number | null;
  homework: { complete: number; due: number } | null;
}

export interface Rating {
  label: string;
  percent: number;
  basis: string;
}

/**
 * The overall rating, only from an approved rubric, only from the parts
 * that have data: a weight whose figure is missing is left out and the
 * rest are rescaled, and the basis says so. With no rubric, "Not yet
 * assessed" is what the screen prints, and this returns null.
 */
export function overallRating(rubric: Rubric | null, input: RatingInput): Rating | null {
  if (!rubric) return null;
  const parts: { weight: number; value: number; name: string }[] = [];
  if (input.attendancePercent !== null && rubric.attendance > 0) parts.push({ weight: rubric.attendance, value: input.attendancePercent, name: 'attendance' });
  if (input.testsAverage !== null && rubric.tests > 0) parts.push({ weight: rubric.tests, value: input.testsAverage, name: 'tests' });
  if (input.homework && input.homework.due > 0 && rubric.homework > 0) parts.push({ weight: rubric.homework, value: Math.round((input.homework.complete / input.homework.due) * 100), name: 'homework' });
  if (parts.length === 0) return null;
  const total = parts.reduce((n, p) => n + p.weight, 0);
  const percent = Math.round(parts.reduce((n, p) => n + (p.value * p.weight) / total, 0));
  let label = rubric.bands[0].label;
  for (const b of rubric.bands) if (percent >= b.minPercent) label = b.label;
  const missing = ['attendance', 'tests', 'homework'].filter((n) => !parts.some((p) => p.name === n) && (rubric as unknown as Record<string, number>)[n] > 0);
  return {
    label,
    percent,
    basis: `${parts.map((p) => `${p.name} ${Math.round((p.weight / total) * 100)}%`).join(', ')}${missing.length ? `; ${missing.join(' and ')} left out for want of data and the rest rescaled` : ''}.`,
  };
}

export interface LevelProgress {
  current: string | null;
  completed: string[];
  remaining: string[];
  basis: string;
}

/** Where a learner is on the program's ladder, from the batches they finished and the one they are in. */
export function levelProgress(levels: string[], completedLevels: string[], currentLevel: string | null): LevelProgress {
  const done = new Set(completedLevels);
  const completed = levels.filter((l) => done.has(l));
  const remaining = levels.filter((l) => !done.has(l) && l !== currentLevel);
  return { current: currentLevel, completed, remaining, basis: levels.length ? `${completed.length} of ${levels.length} levels completed, by batches finished.` : 'The program has no levels.' };
}
