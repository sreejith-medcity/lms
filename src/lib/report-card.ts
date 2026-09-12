import { gradeFor, type Band } from '@/lib/grading';

/**
 * A report card's figures, worked out from what the term produced.
 *
 * Attendance is classes held against classes sat. Tests count the best
 * released attempt at each paper, because a fourth attempt that finally
 * passed is the one that says what the learner can now do. Homework
 * counts the latest graded hand-in. The overall figure is the plain mean
 * of every test and homework percentage, and the grade is read from the
 * academy's own bands, so a 79.5 has a name on the day it happens.
 *
 * Pure, so the sheet the office previews and the sheet the parent gets
 * are the same arithmetic, and the tests can say so.
 */

export interface ReportCardInputs {
  attendance: { held: number; attended: number; late: number };
  tests: { title: string; percent: number; passed: boolean | null; on: string }[];
  homework: { title: string; marks: number; maxMarks: number; on: string }[];
  bands: Band[];
}

export interface ReportCardRow {
  title: string;
  percent: number;
  grade: string | null;
  note: string;
  on: string;
}

export interface ReportCardData {
  attendance: { held: number; attended: number; late: number; percent: number | null; grade: string | null };
  tests: ReportCardRow[];
  homework: ReportCardRow[];
  overall: { percent: number | null; grade: string | null; label: string | null; point: number | null };
}

const one = (n: number) => Math.round(n * 10) / 10;

export function buildReportCard(input: ReportCardInputs): ReportCardData {
  const attendancePercent = input.attendance.held > 0 ? one((input.attendance.attended / input.attendance.held) * 100) : null;
  const tests: ReportCardRow[] = input.tests.map((t) => ({
    title: t.title,
    percent: one(t.percent),
    grade: gradeFor(t.percent, input.bands)?.grade ?? null,
    note: t.passed === true ? 'Passed' : t.passed === false ? 'Not passed' : '',
    on: t.on,
  }));
  const homework: ReportCardRow[] = input.homework.map((h) => {
    const percent = h.maxMarks > 0 ? one((h.marks / h.maxMarks) * 100) : 0;
    return { title: h.title, percent, grade: gradeFor(percent, input.bands)?.grade ?? null, note: `${trim(h.marks)} / ${trim(h.maxMarks)}`, on: h.on };
  });
  const all = [...tests, ...homework].map((r) => r.percent);
  const overallPercent = all.length ? one(all.reduce((n, p) => n + p, 0) / all.length) : null;
  const band = overallPercent === null ? null : gradeFor(overallPercent, input.bands);
  return {
    attendance: { ...input.attendance, percent: attendancePercent, grade: attendancePercent === null ? null : (gradeFor(attendancePercent, input.bands)?.grade ?? null) },
    tests,
    homework,
    overall: { percent: overallPercent, grade: band?.grade ?? null, label: band?.label ?? null, point: band?.point ?? null },
  };
}

/** The best released attempt per paper, which is the one the card reports. */
export function bestAttempts<T extends { assessmentId: string; scorePercent: number | null }>(attempts: T[]): T[] {
  const best = new Map<string, T>();
  for (const a of attempts) {
    if (a.scorePercent === null) continue;
    const cur = best.get(a.assessmentId);
    if (!cur || (cur.scorePercent ?? -1) < a.scorePercent) best.set(a.assessmentId, a);
  }
  return [...best.values()];
}

/** The latest graded hand-in per assignment. */
export function latestGraded<T extends { assignmentId: string; attemptNo: number }>(subs: T[]): T[] {
  const latest = new Map<string, T>();
  for (const s of subs) {
    const cur = latest.get(s.assignmentId);
    if (!cur || s.attemptNo > cur.attemptNo) latest.set(s.assignmentId, s);
  }
  return [...latest.values()];
}

export function readReportCard(raw: unknown): ReportCardData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ReportCardData>;
  if (!r.attendance || !Array.isArray(r.tests) || !Array.isArray(r.homework) || !r.overall) return null;
  return r as ReportCardData;
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
