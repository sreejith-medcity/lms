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
  return { ok: true, value: { name, code, description: input.description.trim().slice(0, 500) || null, levels, skills, assessmentCategories: categories, passPercent, retestRule } };
}
