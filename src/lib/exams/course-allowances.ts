import { db } from '@/lib/db';
import { courseAllowances } from '@/lib/exams/allowance';

/**
 * A learner's allowances from their courses, kept in step with the courses.
 *
 * Each live enrolment whose course includes mock tests has one COURSE
 * allowance, at the course's level. A changed number on the course changes
 * the row; an enrolment that ends revokes it. Run when the learner opens
 * their tests and before a paper starts, so nothing needs a schedule.
 *
 * On the day a course allowance is first written, what the learner already
 * sat on the separate telc site (the results it posted back) is counted as
 * used, at that level, so moving the tests inside does not hand anybody a
 * fresh allowance.
 */
export async function syncCourseAllowances(organizationId: string, userId: string): Promise<void> {
  const [enrolments, existing] = await Promise.all([
    db.enrollment.findMany({
      where: { organizationId, userId },
      select: { id: true, status: true, expiresAt: true, product: { select: { title: true, course: { select: { mockTestAttempts: true, level: true } } } } },
    }),
    db.examAllowance.findMany({ where: { organizationId, userId, source: 'COURSE' } }),
  ]);
  const now = new Date();
  const wanted = courseAllowances(
    enrolments.map((e) => ({
      enrollmentId: e.id,
      live: ['ENROLLED', 'REGISTERED', 'COMPLETED'].includes(e.status) && (!e.expiresAt || e.expiresAt > now),
      mockTestAttempts: e.product.course?.mockTestAttempts ?? null,
      level: e.product.course?.level ?? null,
      title: e.product.title,
    })),
  );

  for (const w of wanted) {
    const row = existing.find((a) => a.enrollmentId === w.enrollmentId);
    if (!w.live) {
      if (row && !row.revokedAt) await db.examAllowance.update({ where: { id: row.id }, data: { revokedAt: now, note: 'The enrolment ended.' } });
      continue;
    }
    if (!row) {
      const before = await db.partnerResult.count({ where: { organizationId, userId, provider: 'telc', ...(w.level ? { level: w.level } : {}) } });
      await db.examAllowance.create({
        data: { organizationId, userId, familyCode: w.familyCode, level: w.level, tests: w.tests, used: Math.min(w.tests, before), source: 'COURSE', enrollmentId: w.enrollmentId, note: before ? `${before} sat on the telc site before the move.` : '' },
      });
      continue;
    }
    if (row.tests !== w.tests || row.level !== w.level || row.revokedAt) {
      await db.examAllowance.update({ where: { id: row.id }, data: { tests: w.tests, level: w.level, revokedAt: null } });
    }
  }
  /* An allowance whose enrolment is gone altogether, or whose course no longer includes tests. */
  for (const row of existing) {
    if (row.revokedAt) continue;
    if (!wanted.some((w) => w.enrollmentId === row.enrollmentId)) {
      await db.examAllowance.update({ where: { id: row.id }, data: { revokedAt: now, note: 'The course no longer includes mock tests.' } });
    }
  }
}
