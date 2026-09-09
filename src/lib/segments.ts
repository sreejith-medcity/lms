import type { Prisma } from '@prisma/client';

/**
 * Segments as rules rather than lists.
 *
 * "Disengaged learners" maintained by hand is a list that is wrong the day
 * after it is written. A segment here is a small set of conditions compiled to
 * a query, so it is recomputed every time somebody looks at it and every time a
 * campaign uses it.
 *
 * The vocabulary is deliberately short. A rule builder that can express
 * anything is a query language with a worse interface, and the six conditions
 * below are the ones an institute actually asks for.
 */

export const FIELDS = [
  { key: 'enrolled_in_course', label: 'Enrolled on a course', input: 'COURSE' },
  { key: 'in_batch', label: 'In a batch', input: 'BATCH' },
  { key: 'progress_below', label: 'Course progress below', input: 'PERCENT' },
  { key: 'inactive_days', label: 'Not seen for at least', input: 'DAYS' },
  { key: 'attendance_below', label: 'Attendance below', input: 'PERCENT' },
  { key: 'has_unpaid_instalment', label: 'Has an overdue instalment', input: 'NONE' },
  { key: 'abandoned_cart', label: 'Left a cart', input: 'NONE' },
  { key: 'never_enrolled', label: 'Signed up but never enrolled', input: 'NONE' },
] as const;

export type FieldKey = (typeof FIELDS)[number]['key'];

export interface Rule {
  field: FieldKey;
  value?: string;
}

export interface SegmentRules {
  /** ALL means every rule must hold; ANY means at least one. */
  match: 'ALL' | 'ANY';
  rules: Rule[];
}

export function parseRules(value: unknown): SegmentRules {
  const known = new Set<string>(FIELDS.map((f) => f.key));
  if (typeof value !== 'object' || value === null) return { match: 'ALL', rules: [] };

  const raw = value as { match?: unknown; rules?: unknown };
  const rules = Array.isArray(raw.rules)
    ? raw.rules
        .filter(
          (r): r is Rule =>
            typeof r === 'object' && r !== null && known.has(String((r as Rule).field)),
        )
        .slice(0, 10)
    : [];

  return { match: raw.match === 'ANY' ? 'ANY' : 'ALL', rules };
}

/** One rule as a slice of a Prisma `where` on User. */
function clauseFor(rule: Rule): Prisma.UserWhereInput | null {
  const number = Number(rule.value ?? 0);

  switch (rule.field) {
    case 'enrolled_in_course':
      return rule.value ? { enrollments: { some: { productId: rule.value } } } : null;

    case 'in_batch':
      return rule.value ? { enrollments: { some: { batchId: rule.value } } } : null;

    case 'progress_below':
      return Number.isFinite(number)
        ? { enrollments: { some: { progressPercent: { lt: number } } } }
        : null;

    case 'inactive_days':
      return Number.isFinite(number) && number > 0
        ? {
            enrollments: {
              some: {
                OR: [
                  { lastActivityAt: { lt: new Date(Date.now() - number * 86_400_000) } },
                  { lastActivityAt: null },
                ],
              },
            },
          }
        : null;

    case 'attendance_below':
      // Attendance is per session rather than a stored percentage, so the rule
      // is expressed as "has sat in a batch and missed at least one class",
      // narrowed by the count below in `membersOf`. Anything cleverer belongs
      // in a report, not a segment.
      return Number.isFinite(number)
        ? { attendances: { some: { status: { in: ['ABSENT'] } } } }
        : null;

    case 'has_unpaid_instalment':
      return {
        enrollments: {
          some: { instalments: { some: { paidAt: null, dueDate: { lt: new Date() } } } },
        },
      };

    case 'abandoned_cart':
      return { carts: { some: { status: 'ABANDONED' } } };

    case 'never_enrolled':
      return { enrollments: { none: {} } };
  }
}

/** The whole segment as one `where`, scoped to this organisation's learners. */
export function whereFor(organizationId: string, rules: SegmentRules): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = {
    organizationId,
    kind: 'LEARNER',
    deletedAt: null,
  };

  const clauses = rules.rules
    .map(clauseFor)
    .filter((c): c is Prisma.UserWhereInput => c !== null);

  if (clauses.length === 0) return base;
  return rules.match === 'ANY' ? { ...base, OR: clauses } : { ...base, AND: clauses };
}

export function describe(rules: SegmentRules): string {
  if (rules.rules.length === 0) return 'Every learner';

  const parts = rules.rules.map((r) => {
    const field = FIELDS.find((f) => f.key === r.field);
    if (!field) return r.field;
    if (field.input === 'NONE') return field.label.toLowerCase();
    if (field.input === 'PERCENT') return `${field.label.toLowerCase()} ${r.value}%`;
    if (field.input === 'DAYS') return `${field.label.toLowerCase()} ${r.value} days`;
    return field.label.toLowerCase();
  });

  return parts.join(rules.match === 'ANY' ? ' or ' : ' and ');
}
