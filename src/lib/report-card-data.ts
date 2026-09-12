import { db } from '@/lib/db';
import { DEFAULT_BANDS, parseBands } from '@/lib/grading';
import { bestAttempts, buildReportCard, latestGraded, type ReportCardData } from '@/lib/report-card';
import { dayKey, formatDayLabel } from '@/lib/clock';

/**
 * What one enrolment produced in a period, gathered for a report card.
 *
 * Classes: those held for the learner's batch in the window (cancelled
 * ones and holidays do not count, and neither does a class still to
 * come). Tests: released attempts at papers attached to the course. Homework:
 * graded hand-ins on the course's assignments. Grades come from the
 * academy's active scale, or the default bands when none is set.
 */
export async function gatherReportCard(input: {
  organizationId: string;
  enrollmentId: string;
  from: Date | null;
  to: Date | null;
  timezone: string;
}): Promise<{ data: ReportCardData; learner: { id: string; name: string }; course: string; batch: string | null } | null> {
  const enrolment = await db.enrollment.findFirst({
    where: { id: input.enrollmentId, organizationId: input.organizationId },
    select: {
      id: true,
      userId: true,
      batchId: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
      product: { select: { title: true, course: { select: { id: true } } } },
      batch: { select: { name: true } },
    },
  });
  if (!enrolment) return null;
  const courseId = enrolment.product.course?.id ?? null;
  const from = input.from ?? enrolment.createdAt;
  const to = input.to ?? new Date();
  const window = { gte: from, lte: to };
  const on = (d: Date) => formatDayLabel(dayKey(d, input.timezone), input.timezone);

  const [sessions, attempts, handIns, scale] = await Promise.all([
    enrolment.batchId
      ? db.liveSession.findMany({
          where: { organizationId: input.organizationId, batchId: enrolment.batchId, status: { not: 'CANCELLED' }, startsAt: { gte: from, lte: to < new Date() ? to : new Date() } },
          select: { id: true, attendances: { where: { userId: enrolment.userId }, select: { status: true } } },
        })
      : Promise.resolve([]),
    courseId
      ? db.attempt.findMany({
          where: {
            userId: enrolment.userId,
            status: 'EVALUATED',
            submittedAt: window,
            assessment: { organizationId: input.organizationId, courses: { some: { courseId } } },
          },
          select: { assessmentId: true, scorePercent: true, passed: true, submittedAt: true, assessment: { select: { title: true } } },
        })
      : Promise.resolve([]),
    courseId
      ? db.assignmentSubmission.findMany({
          where: { organizationId: input.organizationId, userId: enrolment.userId, status: 'GRADED', gradedAt: window, assignment: { courseId } },
          select: { assignmentId: true, attemptNo: true, marks: true, gradedAt: true, assignment: { select: { title: true, maxMarks: true } } },
        })
      : Promise.resolve([]),
    db.gradeScale.findFirst({ where: { organizationId: input.organizationId, isActive: true }, select: { bands: true } }),
  ]);

  const held = sessions.length;
  const attended = sessions.filter((s) => s.attendances.some((a) => a.status === 'PRESENT' || a.status === 'LATE')).length;
  const late = sessions.filter((s) => s.attendances.some((a) => a.status === 'LATE')).length;

  const data = buildReportCard({
    attendance: { held, attended, late },
    tests: bestAttempts(attempts).map((a) => ({ title: a.assessment.title, percent: a.scorePercent ?? 0, passed: a.passed, on: a.submittedAt ? on(a.submittedAt) : '' })),
    homework: latestGraded(handIns).map((h) => ({ title: h.assignment.title, marks: h.marks ?? 0, maxMarks: h.assignment.maxMarks, on: h.gradedAt ? on(h.gradedAt) : '' })),
    bands: scale ? parseBands(scale.bands) : DEFAULT_BANDS,
  });

  return { data, learner: enrolment.user, course: enrolment.product.title, batch: enrolment.batch?.name ?? null };
}
