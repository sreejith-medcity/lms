/**
 * Who may do what in the test portal's admin. The keys are permissions the
 * academy's roles already carry, so no role needs editing for the portal:
 * content rides on the question bank, marking on submissions, free papers
 * on enrolment, and setting a paper for a batch on assessments.
 */
export const TEST_PERMS = {
  content: 'question_bank.manage_banks',
  marking: 'submission.evaluate_submissions',
  sittings: 'submission.view_submissions',
  grants: 'new_enrollment.single',
  assign: 'courses.assessments',
  packs: 'courses.pricing_and_publish',
} as const;

export const ANY_TEST_PERM: string[] = Object.values(TEST_PERMS);

/** The last minute of a calendar day in a time zone, as an instant. */
export function endOfDayIn(date: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const guess = new Date(`${date}T23:59:00Z`);
  if (Number.isNaN(guess.getTime())) return null;
  let offsetMs = 0;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(guess)
        .map((p) => [p.type, p.value]),
    );
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    offsetMs = local - guess.getTime();
  } catch {
    offsetMs = 0;
  }
  return new Date(guess.getTime() - offsetMs);
}

/** The ways a learner's phone number may have been stored, for matching a pasted list. */
export function phoneVariants(raw: string): string[] {
  const p = raw.replace(/[^\d+]/g, '');
  if (!p) return [];
  const digits = p.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  const out = new Set([p, digits]);
  if (last10.length === 10) {
    out.add(last10);
    out.add(`+91${last10}`);
    out.add(`91${last10}`);
  }
  if (!p.startsWith('+') && digits.length > 10) out.add(`+${digits}`);
  return [...out];
}
