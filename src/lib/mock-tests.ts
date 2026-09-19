/**
 * How many partner mock tests a learner is entitled to.
 *
 * Each course may include a number of full-length mock tests on the
 * partner site (the TELC AI Mocktest today). A learner on two courses
 * gets both allowances; a learner whose courses say nothing gets the
 * partner's own default, which is what "null" means here. The partner is
 * told the number at every login, so a change on the course reaches the
 * learner the next time they open the test, with nothing to sync.
 *
 * Pure: the data layer hands in the enrolments and the count.
 */

export interface MockTestAllowance {
  /** Tests the learner's courses include together; null when no course sets one. */
  limit: number | null;
  /** Results the partner has posted back for this learner. */
  used: number;
}

/** The courses' allowances added up; null when none of them names one. */
export function sumMockTestAttempts(courses: { mockTestAttempts: number | null }[]): number | null {
  let total: number | null = null;
  for (const c of courses) {
    if (c.mockTestAttempts === null || c.mockTestAttempts < 0) continue;
    total = (total ?? 0) + Math.floor(c.mockTestAttempts);
  }
  return total;
}

/** What is left, never below zero; null when there is no limit. */
export function mockTestsLeft(a: MockTestAllowance): number | null {
  return a.limit === null ? null : Math.max(0, a.limit - a.used);
}

/** The line under the button: "3 of 5 used", "5 of 5 used, none left", or nothing. */
export function mockTestLine(a: MockTestAllowance): string | null {
  if (a.limit === null) return null;
  const left = mockTestsLeft(a) ?? 0;
  if (left === 0) return `${Math.min(a.used, a.limit)} of ${a.limit} used, none left`;
  return `${a.used} of ${a.limit} used`;
}

/**
 * The same allowance, per level, for a partner that sells papers by
 * level. A course names its level in its own field, else in its title
 * ("German Language - B1"); one that names none goes under "*", which
 * the partner spreads across the levels the learner is on. Null when
 * no course sets an allowance.
 */
export function mockTestsByLevel(courses: { mockTestAttempts: number | null; level: string | null; title: string }[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  let any = false;
  for (const c of courses) {
    if (c.mockTestAttempts === null || c.mockTestAttempts < 0) continue;
    any = true;
    const key = levelOf(c.level, c.title) ?? '*';
    out[key] = (out[key] ?? 0) + Math.floor(c.mockTestAttempts);
  }
  return any ? out : null;
}

const CEFR = /\b([ABC][12])\b/i;

/** "B1" from the course's level field or its title; null when neither names one. */
export function levelOf(level: string | null, title: string): string | null {
  const hit = (level ?? '').match(CEFR) ?? title.match(CEFR);
  return hit ? hit[1].toUpperCase() : null;
}
