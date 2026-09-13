import { db } from '@/lib/db';
import { assessmentClosesItem, assignmentDueItem, classItem, type AgendaItem } from '@/lib/agenda';
import { assignmentsWhereFor, learnerEnrolments } from '@/lib/assignment-access';

/**
 * Everything on a learner's calendar between two instants: classes for
 * the batches they are in, their one-to-one lessons, homework due dates
 * and the closing time of any test with a window. Read once for the week
 * view and the feed alike.
 */
export async function agendaFor(input: { organizationId: string; userId: string; from: Date; to: Date; timeZone: string }): Promise<AgendaItem[]> {
  const enrolments = await learnerEnrolments(input.organizationId, input.userId);
  const batchIds = enrolments.map((e) => e.batchId).filter((id): id is string => Boolean(id));
  const courseIds = enrolments.map((e) => e.product.course?.id).filter((id): id is string => Boolean(id));
  const clauses = assignmentsWhereFor(enrolments);
  const window = { gte: input.from, lte: input.to };

  const [sessions, assignments, assessments] = await Promise.all([
    db.liveSession.findMany({
      where: {
        organizationId: input.organizationId,
        startsAt: window,
        OR: [...(batchIds.length ? [{ batchId: { in: batchIds } }] : []), { learnerId: input.userId }],
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, title: true, startsAt: true, endsAt: true, status: true, isHoliday: true, joinUrl: true, learnerId: true, batch: { select: { name: true } } },
    }),
    clauses.length
      ? db.assignment.findMany({
          where: { organizationId: input.organizationId, deletedAt: null, status: 'PUBLISHED', dueAt: window, OR: clauses },
          select: { id: true, title: true, dueAt: true, course: { select: { product: { select: { title: true } } } } },
        })
      : Promise.resolve([]),
    courseIds.length
      ? db.assessment.findMany({
          where: { organizationId: input.organizationId, closesAt: window, courses: { some: { courseId: { in: courseIds } } } },
          select: { id: true, title: true, closesAt: true },
        })
      : Promise.resolve([]),
  ]);

  const now = new Date();
  return [
    ...sessions.map((s) => classItem({ ...s, batchName: s.batch?.name ?? null }, input.timeZone, now)),
    ...assignments.filter((a) => a.dueAt).map((a) => assignmentDueItem({ id: a.id, title: a.title, dueAt: a.dueAt!, course: a.course.product.title }, input.timeZone)),
    ...assessments.filter((a) => a.closesAt).map((a) => assessmentClosesItem({ id: a.id, title: a.title, closesAt: a.closesAt! }, input.timeZone)),
  ];
}
