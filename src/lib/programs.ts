/**
 * The academic shape above a course: levels, skills, the kinds of test a
 * teacher may set, and the rules that turn marks into an outcome. Pure
 * parsing here; the screen and the actions read it.
 */

export const STANDARD_CATEGORIES = ['Class Test', 'Homework', 'Mock Test', 'Module Test', 'Monthly Test', 'Final Examination', 'Other'] as const;

export type RetestRule = 'FIRST' | 'LATEST' | 'BEST';

export const RETEST_RULES: { value: RetestRule; label: string; help: string }[] = [
  { value: 'LATEST', label: 'Latest attempt', help: 'The most recent sitting stands; a retest replaces the earlier mark on the trend.' },
  { value: 'BEST', label: 'Best attempt', help: 'The highest mark stands, whichever sitting earned it.' },
  { value: 'FIRST', label: 'First attempt', help: 'The first sitting stands; retests are recorded but do not move the trend.' },
];

/** "A1, A2, B1" or one per line → a clean, ordered, de-duplicated list. */
export function parseList(raw: string, max = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const v = part.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export interface ProgramInput {
  name: string;
  code: string;
  description: string;
  levels: string;
  skills: string;
  categories: string;
  passPercent: string;
  retestRule: string;
  lateAfterMinutes?: string;
  onlineAbsentAfterMinutes?: string;
  /** Rubric weights; all three blank means no rubric. */
  ratingAttendance?: string;
  ratingTests?: string;
  ratingHomework?: string;
  /** "Excellent:85, Good:70, Needs attention:0" or one per line. */
  ratingBands?: string;
}

export interface ProgramShape {
  name: string;
  code: string | null;
  description: string | null;
  levels: string[];
  skills: string[];
  assessmentCategories: string[];
  passPercent: number | null;
  retestRule: RetestRule;
  lateAfterMinutes: number | null;
  onlineAbsentAfterMinutes: number | null;
  ratingRubric: { attendance: number; tests: number; homework: number; bands: { label: string; minPercent: number }[] } | null;
}

function minutes(raw: string | undefined, max: number): number | null | 'bad' {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return 'bad';
  return Math.round(n);
}

/** "Excellent:85, Good:70, Needs attention:0" → ascending bands, or null when blank, or 'bad'. */
export function parseBandsText(raw: string | undefined): { label: string; minPercent: number }[] | null | 'bad' {
  const parts = (raw ?? '').split(/[\n,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: { label: string; minPercent: number }[] = [];
  for (const part of parts) {
    const i = part.lastIndexOf(':');
    if (i < 1) return 'bad';
    const label = part.slice(0, i).trim().slice(0, 40);
    const n = Number(part.slice(i + 1).trim());
    if (!label || !Number.isFinite(n) || n < 0 || n > 100) return 'bad';
    out.push({ label, minPercent: Math.round(n) });
  }
  out.sort((a, b) => a.minPercent - b.minPercent);
  if (out[0].minPercent !== 0) return 'bad';
  return out;
}

/** Turns a form into a program, or says what is wrong with it. */
export function parseProgram(input: ProgramInput): { ok: true; value: ProgramShape } | { ok: false; error: string } {
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (name.length < 2) return { ok: false, error: 'Give the program a name.' };
  const code = input.code.trim().toUpperCase().slice(0, 20) || null;
  const levels = parseList(input.levels);
  const skills = parseList(input.skills, 12);
  const categories = parseList(input.categories, 20);
  if (categories.length === 0) return { ok: false, error: 'A program needs at least one kind of test, or teachers cannot set any.' };
  const passRaw = input.passPercent.trim();
  let passPercent: number | null = null;
  if (passRaw) {
    const n = Number(passRaw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: 'The pass mark is a percentage between 0 and 100.' };
    passPercent = Math.round(n);
  }
  const retestRule: RetestRule = input.retestRule === 'FIRST' || input.retestRule === 'BEST' ? input.retestRule : 'LATEST';
  const lateAfterMinutes = minutes(input.lateAfterMinutes, 120);
  if (lateAfterMinutes === 'bad') return { ok: false, error: 'Late after is a number of minutes, up to 120.' };
  const onlineAbsentAfterMinutes = minutes(input.onlineAbsentAfterMinutes, 180);
  if (onlineAbsentAfterMinutes === 'bad') return { ok: false, error: 'The online check time is a number of minutes, up to 180.' };

  const weights = [input.ratingAttendance, input.ratingTests, input.ratingHomework].map((w) => (w ?? '').trim());
  let ratingRubric: ProgramShape['ratingRubric'] = null;
  if (weights.some(Boolean)) {
    const [attendance, tests, homework] = weights.map((w) => (w ? Number(w) : 0));
    if (![attendance, tests, homework].every((n) => Number.isFinite(n) && n >= 0)) return { ok: false, error: 'Rubric weights are numbers.' };
    if (Math.round(attendance + tests + homework) !== 100) return { ok: false, error: 'Rubric weights must add up to 100.' };
    const bands = parseBandsText(input.ratingBands);
    if (bands === 'bad') return { ok: false, error: 'Rubric bands read "Label:minimum percent", the lowest at 0, for example "Excellent:85, Good:70, Needs attention:0".' };
    if (!bands) return { ok: false, error: 'Give the rubric its bands, or clear the weights to leave the rating off.' };
    ratingRubric = { attendance, tests, homework, bands };
  }
  return { ok: true, value: { name, code, description: input.description.trim().slice(0, 500) || null, levels, skills, assessmentCategories: categories, passPercent, retestRule, lateAfterMinutes, onlineAbsentAfterMinutes, ratingRubric } };
}
