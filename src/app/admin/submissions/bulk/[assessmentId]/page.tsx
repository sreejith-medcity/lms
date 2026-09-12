import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { isHumanMarked } from '@/lib/question-scoring';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { BulkMarkForm, type BulkQuestion } from './bulk-form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * A whole class on one screen, question by question.
 *
 * Every answer to question five is read together, which is how marks come
 * out consistent: the fourth essay is judged against the first three, not
 * against a memory of last week's. The objective part is already marked
 * and shown as a running total per learner; one press publishes every
 * paper that has a mark in every box.
 */
export default async function BulkMarkPage({ params }: { params: Promise<{ assessmentId: string }> }) {
  const { assessmentId } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('submission.view_submissions', 'view');
  const canMark = me.permissions['submission.evaluate_submissions']?.edit ?? false;

  const assessment = await db.assessment.findFirst({
    where: { id: assessmentId, organizationId: tenant.organizationId },
    select: {
      id: true,
      title: true,
      passPercent: true,
      questions: { orderBy: { sortOrder: 'asc' }, select: { marks: true, question: { select: { id: true, type: true, promptHtml: true, marks: true, answerKey: true, options: { select: { id: true, label: true, isCorrect: true } } } } } },
      attempts: {
        where: { status: { in: ['SUBMITTED', 'EVALUATED'] }, submission: { status: { in: ['NOT_EVALUATED', 'AI_DRAFTED'] } } },
        orderBy: { submittedAt: 'asc' },
        select: {
          id: true,
          attemptNo: true,
          submittedAt: true,
          user: { select: { id: true, name: true } },
          submission: { select: { status: true, aiDraftFeedback: true } },
          answers: { select: { questionId: true, response: true, marksAwarded: true, isCorrect: true } },
        },
      },
      _count: { select: { attempts: true } },
    },
  });
  if (!assessment) notFound();

  const paperTotal = assessment.questions.reduce((n, q) => n + (q.marks ?? q.question.marks), 0);
  const humanQuestions: BulkQuestion[] = assessment.questions
    .filter((q) => isHumanMarked(q.question.type))
    .map((q) => ({ id: q.question.id, type: q.question.type, prompt: q.question.promptHtml, maxMarks: q.marks ?? q.question.marks }));

  const papers = assessment.attempts.map((a) => ({
    attemptId: a.id,
    learner: a.user.name,
    attemptNo: a.attemptNo,
    drafted: a.submission?.status === 'AI_DRAFTED',
    aiDraft: a.submission?.aiDraftFeedback ?? '',
    objective: assessment.questions
      .filter((q) => !isHumanMarked(q.question.type))
      .reduce((n, q) => n + (a.answers.find((x) => x.questionId === q.question.id)?.marksAwarded ?? 0), 0),
    answers: Object.fromEntries(
      humanQuestions.map((q) => {
        const ans = a.answers.find((x) => x.questionId === q.id);
        return [q.id, { response: (ans?.response ?? null) as unknown, current: ans?.marksAwarded ?? null }];
      }),
    ),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={assessment.title}
        description={`${papers.length} paper${papers.length === 1 ? '' : 's'} waiting · out of ${paperTotal} · pass at ${assessment.passPercent}%`}
        action={
          <Link href="/admin/submissions" className="t-small faint hover:underline">
            Marking
          </Link>
        }
      />

      {papers.length === 0 ? (
        <EmptyState title="Nothing waiting on this paper" hint="Every attempt has been marked and released." />
      ) : humanQuestions.length === 0 ? (
        <EmptyState title="Nothing for a person to mark" hint="This paper is all machine-marked. The papers waiting here only need publishing, which the form below does." action={<Badge tone="neutral">objective only</Badge>} />
      ) : null}

      <BulkMarkForm assessmentId={assessment.id} questions={humanQuestions} papers={papers} paperTotal={paperTotal} canMark={canMark} attemptsTotal={assessment._count.attempts} />
    </div>
  );
}
