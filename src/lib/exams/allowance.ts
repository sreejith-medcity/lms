/**
 * Who may sit how many papers.
 *
 * An allowance is for a family (telc) at a level (B1) or at any level, so
 * many papers or unlimited, from one of four places: a course that
 * includes mock tests, a pack bought on its own, a grant from staff, or
 * the free sample. A sitting draws on one allowance when it starts and
 * counts against it when it is submitted or its clock runs out. Pure: the
 * data layer hands in the rows.
 */

export interface AllowanceRow {
  id: string;
  familyCode: string;
  level: string | null;
  tests: number | null;
  used: number;
  source: 'COURSE' | 'PACK' | 'GRANT' | 'SAMPLE';
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export function isLive(a: AllowanceRow, now: Date): boolean {
  if (a.revokedAt) return false;
  if (a.expiresAt && a.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export function left(a: AllowanceRow): number | null {
  return a.tests === null ? null : Math.max(0, a.tests - a.used);
}

export function covers(a: AllowanceRow, familyCode: string, level: string | null): boolean {
  if (a.familyCode !== familyCode) return false;
  if (a.level === null) return true;
  return a.level === level;
}

/* The free one goes first, then what a course gave, then a grant, then
   what was paid for: whatever is spent last is the one with the most
   claim to still be there. */
const ORDER: Record<AllowanceRow['source'], number> = { SAMPLE: 0, COURSE: 1, GRANT: 2, PACK: 3 };

/** The allowance a new sitting draws on, or null when there is none with anything left. */
export function pickAllowance(rows: AllowanceRow[], familyCode: string, level: string | null, now: Date): AllowanceRow | null {
  const fit = rows.filter((a) => isLive(a, now) && covers(a, familyCode, level) && (left(a) === null || (left(a) ?? 0) > 0));
  fit.sort((a, b) => {
    /* A level's own allowance before an any-level one, so the general one is kept for another level. */
    const la = a.level ? 0 : 1;
    const lb = b.level ? 0 : 1;
    if (la !== lb) return la - lb;
    if (ORDER[a.source] !== ORDER[b.source]) return ORDER[a.source] - ORDER[b.source];
    const ea = a.expiresAt?.getTime() ?? Infinity;
    const eb = b.expiresAt?.getTime() ?? Infinity;
    return ea - eb;
  });
  return fit[0] ?? null;
}

export interface LevelStanding {
  level: string | null;
  /** Papers left across the live allowances; null when any of them is unlimited. */
  left: number | null;
  used: number;
  sources: AllowanceRow['source'][];
}

/** What a learner has for a family, per level, for the portal page. */
export function standing(rows: AllowanceRow[], familyCode: string, now: Date): LevelStanding[] {
  const live = rows.filter((a) => isLive(a, now) && a.familyCode === familyCode);
  const levels = new Map<string | null, LevelStanding>();
  for (const a of live) {
    const s = levels.get(a.level) ?? { level: a.level, left: 0, used: 0, sources: [] };
    s.left = s.left === null || a.tests === null ? null : s.left + (left(a) ?? 0);
    s.used += a.used;
    if (!s.sources.includes(a.source)) s.sources.push(a.source);
    levels.set(a.level, s);
  }
  return [...levels.values()].sort((a, b) => String(a.level ?? '~').localeCompare(String(b.level ?? '~')));
}

/** Papers left at a level counting the any-level allowance too; null for unlimited. */
export function leftAt(rows: AllowanceRow[], familyCode: string, level: string | null, now: Date): number {
  const fit = rows.filter((a) => isLive(a, now) && covers(a, familyCode, level));
  let total = 0;
  for (const a of fit) {
    const l = left(a);
    if (l === null) return Infinity;
    total += l;
  }
  return total;
}

const CEFR = /\b([ABC][12])\b/i;

/** "B1" from a course's level field or its title; null when neither names one. */
export function levelOf(level: string | null, title: string): string | null {
  const hit = (level ?? '').match(CEFR) ?? title.match(CEFR);
  return hit ? hit[1].toUpperCase() : null;
}

export interface CourseAllowanceInput {
  enrollmentId: string;
  live: boolean;
  mockTestAttempts: number | null;
  level: string | null;
  title: string;
}

/**
 * The COURSE allowances an enrolment list should have: one per live
 * enrolment whose course includes mock tests, for the telc family at the
 * course's level (any level when the course names none). The rows are
 * synced to this: a course that changes its number changes the row, an
 * enrolment that ends revokes it.
 */
export function courseAllowances(courses: CourseAllowanceInput[], familyCode = 'telc'): { enrollmentId: string; familyCode: string; level: string | null; tests: number; live: boolean }[] {
  return courses
    .filter((c) => c.mockTestAttempts !== null && c.mockTestAttempts >= 0)
    .map((c) => ({ enrollmentId: c.enrollmentId, familyCode, level: levelOf(c.level, c.title), tests: Math.floor(c.mockTestAttempts ?? 0), live: c.live }));
}

/** "3 of 5 left", "none left", "unlimited". */
export function standingLine(s: { left: number | null; used: number }): string {
  if (s.left === null) return 'unlimited';
  if (s.left === 0) return `none left (${s.used} used)`;
  return `${s.left} left${s.used ? `, ${s.used} used` : ''}`;
}
