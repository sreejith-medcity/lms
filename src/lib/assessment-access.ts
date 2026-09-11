import { db } from '@/lib/db';
import {
  attemptAllowance,
  poolState,
  type Allowance,
} from '@/lib/assessment-allowance';

/**
 * Whether this learner may sit this test, and how many goes they have left.
 *
 * Three ways in, and they have to be asked about together because they
 * override each other: the course includes it, the academy has given it to
 * this person, or it is in a set they hold an allowance for. Answering that
 * in one function is what stops the page saying one thing and the button
 * doing another, which is the version of this bug learners actually report.
 *
 * The arithmetic is in `assessment-allowance.ts` and tested there. This is
 * the part that reads rows.
 */

export interface AssessmentAccess {
  entitled: boolean;
  via: 'COURSE' | 'GRANT' | 'POOL' | null;
  allowance: Allowance;
  /** Set when their way in is a pool, so the page can say what is left of it. */
  pool: { id: string; name: string; state: Allowance } | null;
  /** Everything considered: may they open a new attempt right now? */
  canStart: boolean;
  message?: string;
}

export async function assessmentAccess(input: {
  organizationId: string;
  userId: string;
  assessmentId: string;
  /** Staff previewing a paper are not held to a learner's limits. */
  isStaff?: boolean;
  now?: Date;
}): Promise<AssessmentAccess> {
  const now = input.now ?? new Date();

  const assessment = await db.assessment.findFirst({
    where: { id: input.assessmentId, organizationId: input.organizationId },
    select: {
      id: true,
      maxAttempts: true,
      opensAt: true,
      closesAt: true,
      courses: { select: { courseId: true } },
    },
  });

  if (!assessment) {
    return {
      entitled: false,
      via: null,
      pool: null,
      canStart: false,
      allowance: { ok: false, allowed: 0, used: 0, left: 0 },
      message: 'That test is not available.',
    };
  }

  const courseIds = assessment.courses.map((c) => c.courseId);

  const [enrolled, grant, attempts, poolGrants] = await Promise.all([
    courseIds.length > 0
      ? db.enrollment.findFirst({
          where: {
            userId: input.userId,
            organizationId: input.organizationId,
            status: { notIn: ['CANCELLED', 'ARCHIVED'] },
            product: { course: { id: { in: courseIds } } },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
    // Scoped by organisation as well as by the pair, even though the pair is
    // unique: the assessment was already found inside this academy, and the
    // audit is right that a query which reads as tenant-free eventually is.
    db.assessmentGrant.findFirst({
      where: {
        organizationId: input.organizationId,
        assessmentId: assessment.id,
        userId: input.userId,
      },
      select: { isAssigned: true, extraAttempts: true, opensAt: true, closesAt: true },
    }),
    db.attempt.findMany({
      where: { assessmentId: assessment.id, userId: input.userId },
      select: { status: true },
    }),
    db.assessmentPoolGrant.findMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        pool: { isActive: true, items: { some: { assessmentId: assessment.id } } },
      },
      select: {
        allowance: true,
        expiresAt: true,
        pool: { select: { id: true, name: true, items: { select: { assessmentId: true } } } },
      },
    }),
  ]);

  const includedInCourse = Boolean(enrolled);

  const allowance = attemptAllowance({
    rules: {
      maxAttempts: assessment.maxAttempts,
      opensAt: assessment.opensAt,
      closesAt: assessment.closesAt,
    },
    grant: grant
      ? {
          isAssigned: grant.isAssigned,
          extraAttempts: grant.extraAttempts,
          opensAt: grant.opensAt,
          closesAt: grant.closesAt,
        }
      : null,
    includedInCourse,
    attempts,
    now,
  });

  if (input.isStaff) {
    return { entitled: true, via: 'COURSE', allowance, pool: null, canStart: true };
  }

  // A pool is only consulted where the other two do not already let them in:
  // being given a test outright should not also spend a pool place.
  let pool: AssessmentAccess['pool'] = null;
  let poolAllows = false;

  if (!includedInCourse && !grant?.isAssigned && poolGrants.length > 0) {
    for (const held of poolGrants) {
      const ids = held.pool.items.map((i) => i.assessmentId);
      const started = await db.attempt.findMany({
        where: { userId: input.userId, assessmentId: { in: ids } },
        select: { assessmentId: true },
        distinct: ['assessmentId'],
      });

      const state = poolState({
        grant: { allowance: held.allowance, expiresAt: held.expiresAt },
        startedAssessmentIds: started.map((s) => s.assessmentId),
        assessmentId: assessment.id,
        now,
      });

      // The most generous set they hold wins, since holding two is not a
      // reason to be refused by the stingier one.
      if (!pool || (state.ok && !poolAllows)) {
        pool = { id: held.pool.id, name: held.pool.name, state };
      }
      if (state.ok) poolAllows = true;
    }
  }

  const entitled = includedInCourse || Boolean(grant?.isAssigned) || poolAllows;
  const via: AssessmentAccess['via'] = includedInCourse
    ? 'COURSE'
    : grant?.isAssigned
      ? 'GRANT'
      : poolAllows
        ? 'POOL'
        : null;

  if (!entitled) {
    return {
      entitled: false,
      via: null,
      allowance,
      pool,
      canStart: false,
      message: pool?.state.message ?? allowance.message ?? 'This test is not part of your enrolment.',
    };
  }

  // Entitled by a grant or a pool, so the allowance is recomputed as if it
  // were assigned: otherwise a pool place lets them in and the attempt check
  // turns them away for not owning the test.
  const finalAllowance = attemptAllowance({
    rules: {
      maxAttempts: assessment.maxAttempts,
      opensAt: assessment.opensAt,
      closesAt: assessment.closesAt,
    },
    grant: {
      isAssigned: true,
      extraAttempts: grant?.extraAttempts ?? 0,
      opensAt: grant?.opensAt ?? null,
      closesAt: grant?.closesAt ?? null,
    },
    includedInCourse,
    attempts,
    now,
  });

  return {
    entitled: true,
    via,
    allowance: finalAllowance,
    pool,
    canStart: finalAllowance.ok,
    message: finalAllowance.message,
  };
}

/**
 * Every test one learner can see, whatever route it reaches them by.
 *
 * The course's own, the ones given to them, and the ones in any set they
 * hold. Used by the learner's dashboard and by the office when it is looking
 * at what somebody actually has.
 */
export async function assessmentsForLearner(input: {
  organizationId: string;
  userId: string;
}): Promise<{ id: string; title: string; kind: string; via: 'COURSE' | 'GRANT' | 'POOL' }[]> {
  const [courseTests, granted, pooled] = await Promise.all([
    db.assessment.findMany({
      where: {
        organizationId: input.organizationId,
        questions: { some: {} },
        courses: {
          some: {
            course: {
              product: {
                enrollments: {
                  some: { userId: input.userId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
                },
              },
            },
          },
        },
      },
      select: { id: true, title: true, kind: true },
    }),
    db.assessmentGrant.findMany({
      where: { organizationId: input.organizationId, userId: input.userId, isAssigned: true },
      select: { assessment: { select: { id: true, title: true, kind: true } } },
    }),
    db.assessmentPoolGrant.findMany({
      where: { organizationId: input.organizationId, userId: input.userId, pool: { isActive: true } },
      select: {
        pool: {
          select: {
            items: {
              select: { assessment: { select: { id: true, title: true, kind: true } } },
            },
          },
        },
      },
    }),
  ]);

  const seen = new Map<string, { id: string; title: string; kind: string; via: 'COURSE' | 'GRANT' | 'POOL' }>();

  for (const a of courseTests) seen.set(a.id, { ...a, via: 'COURSE' });
  for (const g of granted) {
    if (!seen.has(g.assessment.id)) seen.set(g.assessment.id, { ...g.assessment, via: 'GRANT' });
  }
  for (const p of pooled) {
    for (const item of p.pool.items) {
      if (!seen.has(item.assessment.id)) {
        seen.set(item.assessment.id, { ...item.assessment, via: 'POOL' });
      }
    }
  }

  return [...seen.values()];
}
