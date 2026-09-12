import { db } from '@/lib/db';
import { isHumanMarked } from '@/lib/question-scoring';
import type { BulkPaper } from '@/lib/bulk-marking';

/**
 * What is waiting to be marked, read for the bulk screen. Plain module,
 * not a server action: it takes an organisation id, and a function that
 * takes one of those must never be an endpoint.
 */

/** The papers of one assessment still waiting, shaped for the bulk form. */
export async function bulkPapersFor(organizationId: string, assessmentId: string): Promise<BulkPaper[]> {
  const attempts = await db.attempt.findMany({
    where: { assessmentId, assessment: { organizationId }, status: { in: ['SUBMITTED', 'EVALUATED'] }, submission: { status: { in: ['NOT_EVALUATED', 'AI_DRAFTED'] } } },
    select: {
      id: true,
      answers: { select: { questionId: true, marksAwarded: true, question: { select: { type: true } } } },
      assessment: { select: { questions: { select: { marks: true, question: { select: { id: true, type: true, marks: true } } } } } },
    },
  });
  return attempts.map((a) => ({
    attemptId: a.id,
    toMark: a.assessment.questions
      .filter((q) => isHumanMarked(q.question.type))
      .map((q) => ({ questionId: q.question.id, maxMarks: q.marks ?? q.question.marks, current: a.answers.find((x) => x.questionId === q.question.id)?.marksAwarded ?? null })),
    objective: a.answers.filter((x) => !isHumanMarked(x.question.type)).reduce((n, x) => n + (x.marksAwarded ?? 0), 0),
  }));
}

