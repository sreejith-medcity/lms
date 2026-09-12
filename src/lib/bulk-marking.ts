/**
 * Marking many papers at once, without the database.
 *
 * The bulk screen posts one form for a whole class: a mark per written
 * answer, named `marks:<attemptId>:<questionId>`, and a note per paper
 * named `feedback:<attemptId>`. This reads that form back into numbers,
 * says which papers are complete enough to publish, and totals them, so
 * the action and the tests agree on what "complete" means.
 */

export interface BulkPaper {
  attemptId: string;
  /** Questions a person has to mark on this paper, with their ceiling. */
  toMark: { questionId: string; maxMarks: number; current: number | null }[];
  /** Marks the machine already gave to the objective part. */
  objective: number;
}

export interface ParsedPaper {
  attemptId: string;
  marks: Record<string, number>;
  feedback: string;
  /** Every human-marked question has a mark inside its ceiling. */
  complete: boolean;
  /** Anything at all typed for this paper. */
  touched: boolean;
  total: number;
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

/** Read a bulk form. A blank box falls back to the mark already on the answer (an AI draft, say). */
export function parseBulkForm(papers: BulkPaper[], get: (name: string) => string | null): ParsedPaper[] {
  return papers.map((p) => {
    const marks: Record<string, number> = {};
    let touched = false;
    let complete = true;
    for (const q of p.toMark) {
      const raw = get(`marks:${p.attemptId}:${q.questionId}`);
      const typed = raw !== null && raw.trim() !== '' ? Number(raw) : null;
      if (typed !== null && Number.isFinite(typed)) {
        marks[q.questionId] = clamp(typed, q.maxMarks);
        touched = true;
      } else if (q.current !== null) {
        marks[q.questionId] = clamp(q.current, q.maxMarks);
      } else {
        complete = false;
      }
    }
    const feedback = (get(`feedback:${p.attemptId}`) ?? '').trim();
    if (feedback) touched = true;
    const total = p.objective + Object.values(marks).reduce((n, m) => n + m, 0);
    return { attemptId: p.attemptId, marks, feedback, complete, touched, total };
  });
}

/** Percent, rounded to one place, never below zero. */
export function percentOf(total: number, paperTotal: number): number {
  if (paperTotal <= 0) return 0;
  return Math.max(0, Math.round((total / paperTotal) * 1000) / 10);
}

/**
 * The papers to publish from one press: those complete and either touched
 * now or carrying a draft for every question. A paper with a blank box is
 * left waiting rather than published with a zero the trainer never typed.
 */
export function publishable(parsed: ParsedPaper[], onlyTouched: boolean): ParsedPaper[] {
  return parsed.filter((p) => p.complete && (!onlyTouched || p.touched));
}

/**
 * Group answers by question so a trainer reads every answer to question
 * five together, which is how consistent marks actually get given.
 */
export function byQuestion<T extends { attemptId: string; questionId: string }>(rows: T[], questionOrder: string[]): { questionId: string; rows: T[] }[] {
  return questionOrder.map((questionId) => ({ questionId, rows: rows.filter((r) => r.questionId === questionId) }));
}
