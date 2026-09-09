import type { $Enums } from '@prisma/client';

/**
 * Whether a lesson is open yet, and when it opens if not.
 *
 * Computed in one place because three screens need the same answer: the
 * learner's rail, the player, and the admin's drip table. A locked lesson still
 * appears; hiding it entirely leaves learners wondering whether the course is
 * short or they are missing something.
 */
export interface DripRule {
  materialId: string | null;
  anchor: $Enums.DripAnchor;
  offsetDays: number;
  releaseAt: Date | null;
}

export interface DripContext {
  enrolledAt: Date | null;
  batchStartsAt: Date | null;
}

export function opensAt(rule: DripRule, context: DripContext): Date | null {
  if (rule.anchor === 'SPECIFIC_DATE') return rule.releaseAt;

  const base =
    rule.anchor === 'BATCH_START_DATE' ? context.batchStartsAt : context.enrolledAt;
  if (!base) return null;

  const at = new Date(base);
  at.setDate(at.getDate() + rule.offsetDays);
  at.setHours(0, 0, 0, 0);
  return at;
}

export function isLocked(rule: DripRule | undefined, context: DripContext): Date | null {
  if (!rule) return null;
  const at = opensAt(rule, context);
  if (!at) return null;
  return at > new Date() ? at : null;
}

export function describe(rule: DripRule): string {
  if (rule.anchor === 'SPECIFIC_DATE') {
    return rule.releaseAt
      ? `Opens ${rule.releaseAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : 'Opens on a date not set';
  }
  const when = rule.anchor === 'BATCH_START_DATE' ? 'the batch starts' : 'they enrol';
  if (rule.offsetDays === 0) return `Open as soon as ${when}`;
  return `${rule.offsetDays} day${rule.offsetDays === 1 ? '' : 's'} after ${when}`;
}
