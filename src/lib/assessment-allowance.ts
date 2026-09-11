/**
 * What one candidate may do with one mock test.
 *
 * Three things the office asked for, and they interact, which is why they
 * are worked out in one place rather than three:
 *
 *   a test can be given to a candidate whose course does not include it,
 *   a candidate can be given attempts beyond what the test allows, and
 *   a set of tests can be sold as "any five of these".
 *
 * Every count here is derived from attempts that exist rather than from a
 * stored tally. A counter and a list of attempts disagree the first time an
 * attempt is voided, and when they disagree the candidate is the one who
 * finds out, usually the night before an exam.
 */

export interface AssessmentRules {
  /** The test's own limit, for everybody. */
  maxAttempts: number;
  opensAt: Date | null;
  closesAt: Date | null;
}

export interface LearnerGrant {
  /** Given to this learner even though their course does not include it. */
  isAssigned: boolean;
  extraAttempts: number;
  opensAt: Date | null;
  closesAt: Date | null;
}

export interface AttemptRecord {
  /** A voided attempt is one the academy decided should not count. */
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EVALUATED' | 'EXPIRED' | 'VOID';
}

export type AllowanceRefusal =
  | 'NOT_YOURS'
  | 'NOT_OPEN_YET'
  | 'CLOSED'
  | 'NO_ATTEMPTS_LEFT'
  | 'POOL_SPENT'
  | 'POOL_EXPIRED';

export interface Allowance {
  ok: boolean;
  reason?: AllowanceRefusal;
  message?: string;
  /** Attempts allowed in total, the test's own plus anything granted. */
  allowed: number;
  /** Attempts that count against that. */
  used: number;
  left: number;
}

const MESSAGES: Record<AllowanceRefusal, string> = {
  NOT_YOURS: 'This test is not part of your course. Ask the academy to add it.',
  NOT_OPEN_YET: 'This test is not open yet.',
  CLOSED: 'This test has closed.',
  NO_ATTEMPTS_LEFT: 'You have used all your attempts at this test.',
  POOL_SPENT: 'You have taken as many tests from this set as your allowance covers.',
  POOL_EXPIRED: 'The allowance for this set of tests has expired.',
};

/** An attempt in progress counts: otherwise a second tab is a second attempt. */
export function countsAgainstAllowance(attempt: AttemptRecord): boolean {
  return attempt.status !== 'VOID';
}

export function attemptAllowance(input: {
  rules: AssessmentRules;
  /** Null when the learner has no grant of their own. */
  grant: LearnerGrant | null;
  /** True when their course includes this test. */
  includedInCourse: boolean;
  attempts: AttemptRecord[];
  now?: Date;
}): Allowance {
  const now = input.now ?? new Date();
  const used = input.attempts.filter(countsAgainstAllowance).length;
  const allowed = Math.max(0, input.rules.maxAttempts) + Math.max(0, input.grant?.extraAttempts ?? 0);
  const left = Math.max(0, allowed - used);

  const refuse = (reason: AllowanceRefusal): Allowance => ({
    ok: false,
    reason,
    message: MESSAGES[reason],
    allowed,
    used,
    left,
  });

  const entitled = input.includedInCourse || Boolean(input.grant?.isAssigned);
  if (!entitled) return refuse('NOT_YOURS');

  // A grant's window replaces the test's, not narrows it: that is the point
  // of giving one candidate their own dates before an exam.
  const opensAt = input.grant?.opensAt ?? input.rules.opensAt;
  const closesAt = input.grant?.closesAt ?? input.rules.closesAt;

  if (opensAt && now < opensAt) return refuse('NOT_OPEN_YET');
  if (closesAt && now > closesAt) return refuse('CLOSED');

  if (left <= 0) return refuse('NO_ATTEMPTS_LEFT');

  return { ok: true, allowed, used, left };
}

/* Pools ------------------------------------------------------------------- */

export interface PoolGrantRecord {
  allowance: number;
  expiresAt: Date | null;
}

/**
 * A pool is spent by the number of *tests* started, not attempts made.
 *
 * Somebody allowed five of twenty who takes the same test three times has
 * used one of their five. That is what a buyer understands by "any five",
 * and the alternative punishes a second go at a test they have already paid
 * for out of the same allowance.
 */
export function poolState(input: {
  grant: PoolGrantRecord;
  /** Assessment ids in the pool that this learner has attempted at all. */
  startedAssessmentIds: string[];
  /** The test they are trying to open now. */
  assessmentId: string;
  now?: Date;
}): Allowance {
  const now = input.now ?? new Date();
  const distinct = new Set(input.startedAssessmentIds);
  const used = distinct.size;
  const allowed = Math.max(0, input.grant.allowance);
  const left = Math.max(0, allowed - used);

  const base = { allowed, used, left };

  if (input.grant.expiresAt && now > input.grant.expiresAt) {
    return { ...base, ok: false, reason: 'POOL_EXPIRED', message: MESSAGES.POOL_EXPIRED };
  }

  // Already started this one, so it is already counted and may be continued.
  if (distinct.has(input.assessmentId)) return { ...base, ok: true };

  if (left <= 0) {
    return { ...base, ok: false, reason: 'POOL_SPENT', message: MESSAGES.POOL_SPENT };
  }

  return { ...base, ok: true };
}
