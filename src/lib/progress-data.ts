import { db } from '@/lib/db';
import { settingBool } from '@/lib/settings/store';
import { attendanceFigure, homeworkFigure, levelProgress, overallRating, parseRubric, trends, type Mark, type Result } from '@/lib/progress-rules';

/**
 * A learner's progress on one course, in the shape the parent's screen
 * and the reports read. Everything academic comes from published mark
 * sheets; homework from the teacher's verification; attendance from the
 * classes with a final record. The period is the batch's own span
 * unless a narrower one is asked for.
 */

export interface ProgressPeriod {
  from: Date;
  to: Date;
}

export async function courseProgress(organizationId: string, learnerId: string, enrollmentId: string, period?: ProgressPeriod) {
  const enrolment = await db.enrollment.findFirst({
    where: { id: enrollmentId, organizationId, userId: learnerId },
    select: {
      id: true,
      createdAt: true,
      status: true,
      batchId: true,
      product: { select: { title: true, course: { select: { id: true, program: { select: { name: true, levels: true, retestRule: true, ratingRubric: true } } } } } },
      batch: { select: { id: true, name: true, level: true, startDate: true, endDate: true } },
    },
  });
  if (!enrolment) return null;
  const now = new Date();
  const from = period?.from ?? enrolment.batch?.startDate ?? enrolment.createdAt;
  const to = period?.to ?? (enrolment.batch?.endDate && enrolment.batch.endDate < now ? enrolment.batch.endDate : now);
  const courseId = enrolment.product.course?.id ?? null;
  const program = enrolment.product.course?.program ?? null;
  const gateRemarks = await settingBool(organizationId, 'academics.gateRemarks');

  const [sessions, entries, homework, finished] = await Promise.all([
    enrolment.batchId
      ? db.liveSession.findMany({
          where: { organizationId, batchId: enrolment.batchId, status: 'COMPLETED', isHoliday: false, startsAt: { gte: from, lte: to } },
          orderBy: { startsAt: 'desc' },
          select: { id: true, title: true, startsAt: true, attendances: { where: { userId: learnerId }, select: { status: true, source: true } } },
        })
      : Promise.resolve([]),
    enrolment.batchId
      ? db.markSheetEntry.findMany({
          where: { userId: learnerId, sheet: { organizationId, batchId: enrolment.batchId, status: 'PUBLISHED', supersededById: null, testDate: { gte: from, lte: to } } },
          select: { outcome: true, marks: true, grade: true, passed: true, remark: true, sheet: { select: { id: true, title: true, category: true, skill: true, level: true, testDate: true, maxMarks: true, version: true, publishedAt: true } } },
        })
      : Promise.resolve([]),
    courseId
      ? db.assignment.findMany({
          where: { organizationId, courseId, status: 'PUBLISHED', deletedAt: null, OR: [{ batchId: null }, { batchId: enrolment.batchId ?? '' }], dueAt: { gte: from, lte: to } },
          orderBy: { dueAt: 'desc' },
          select: { id: true, title: true, dueAt: true, submissions: { where: { userId: learnerId }, orderBy: { attemptNo: 'desc' }, take: 1, select: { verification: true, feedback: true, submittedAt: true, verifiedAt: true } } },
        })
      : Promise.resolve([]),
    courseId
      ? db.enrollment.findMany({
          where: { organizationId, userId: learnerId, status: 'COMPLETED', product: { course: { id: courseId } }, batch: { level: { not: null } } },
          select: { batch: { select: { level: true } } },
        })
      : Promise.resolve([]),
  ]);

  const attendance = attendanceFigure({ sessions: sessions.map((s) => ({ id: s.id, startsAt: s.startsAt, status: (s.attendances[0]?.status as Mark | undefined) ?? null })) });
  const results: Result[] = entries.map((e) => ({
    sheetId: e.sheet.id,
    seriesKey: `${e.sheet.title.trim().toLowerCase()}|${e.sheet.category}|${e.sheet.skill ?? ''}`,
    title: e.sheet.title,
    category: e.sheet.category,
    skill: e.sheet.skill,
    level: e.sheet.level,
    testDate: e.sheet.testDate,
    percent: e.outcome === 'SCORED' && e.marks !== null ? Math.round((e.marks / e.sheet.maxMarks) * 1000) / 10 : null,
    passed: e.outcome === 'SCORED' ? e.passed : null,
    grade: e.grade,
    outcome: e.outcome,
    remark: e.remark,
    version: e.sheet.version,
  }));
  const retestRule = program?.retestRule ?? 'LATEST';
  const testTrends = trends(results, retestRule);
  const testsAverage = testTrends.length ? Math.round((testTrends.reduce((n, t) => n + (t.average ?? 0) * t.points.length, 0) / testTrends.reduce((n, t) => n + t.points.length, 0)) * 10) / 10 : null;

  const hw = homeworkFigure({
    items: homework.map((h) => ({ title: h.title, dueAt: h.dueAt, verification: h.submissions[0]?.verification ?? null, handedIn: Boolean(h.submissions[0]?.submittedAt), feedback: h.submissions[0]?.feedback ?? null })),
  });
  // Remarks a parent may read: on a published sheet always; on homework only when the gate is off.
  const remarks = [
    ...results.filter((r) => r.remark).map((r) => ({ on: r.testDate, about: r.title, text: r.remark as string, source: 'test' as const })),
    ...(gateRemarks ? [] : homework.filter((h) => h.submissions[0]?.feedback && h.submissions[0]?.verifiedAt).map((h) => ({ on: h.submissions[0]!.verifiedAt as Date, about: h.title, text: h.submissions[0]!.feedback as string, source: 'homework' as const }))),
  ].sort((a, b) => b.on.getTime() - a.on.getTime());

  const rubric = parseRubric(program?.ratingRubric ?? null);
  const rating = overallRating(rubric, { attendancePercent: attendance.percent, testsAverage, homework: hw.due ? { complete: hw.complete, due: hw.due } : null });
  const levels = levelProgress(program?.levels ?? [], finished.map((f) => f.batch?.level).filter((x): x is string => Boolean(x)), enrolment.batch?.level ?? null);

  const lastUpdate = [
    ...entries.map((e) => e.sheet.publishedAt),
    ...sessions.map((s) => s.startsAt),
    ...homework.map((h) => h.submissions[0]?.verifiedAt ?? null),
  ]
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  return {
    enrolment: { id: enrolment.id, course: enrolment.product.title, batch: enrolment.batch?.name ?? null, level: enrolment.batch?.level ?? null, status: enrolment.status, program: program?.name ?? null },
    period: { from, to },
    lastUpdate,
    attendance,
    classes: sessions.map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt, status: (s.attendances[0]?.status as Mark | undefined) ?? null, corrected: s.attendances[0]?.source === 'CORRECTION' })),
    trends: testTrends,
    testsAverage,
    retestRule,
    results: results.sort((a, b) => b.testDate.getTime() - a.testDate.getTime()),
    homework: hw,
    homeworkItems: homework.map((h) => ({ id: h.id, title: h.title, dueAt: h.dueAt, handedIn: Boolean(h.submissions[0]?.submittedAt), verification: h.submissions[0]?.verification ?? null, feedback: gateRemarks ? null : (h.submissions[0]?.feedback ?? null) })),
    remarks,
    rating,
    rubricSet: rubric !== null,
    levels,
  };
}

export type CourseProgress = NonNullable<Awaited<ReturnType<typeof courseProgress>>>;
