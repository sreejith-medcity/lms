import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge } from '@/components/ui';
import { evaluationFromJson } from '@/components/evaluation-report';
import { presetFor } from '@/lib/ai-evaluation';
import { MarkForm } from './mark-form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function MarkPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const tenant = await requireTenant();
  await requireStaff('submission.view_submissions', 'view');

  const attempt = await db.attempt.findFirst({
    where: { id: attemptId, assessment: { organizationId: tenant.organizationId } },
    select: {
      id: true,
      attemptNo: true,
      status: true,
      scorePercent: true,
      submittedAt: true,
      user: { select: { name: true, email: true } },
      assessment: {
        select: {
          title: true,
          passPercent: true,
          questions: {
            orderBy: { sortOrder: 'asc' },
            select: {
              marks: true,
              question: {
                select: {
                  id: true,
                  type: true,
                  promptHtml: true,
                  marks: true,
                  rubric: true,
                  options: { select: { id: true, label: true, isCorrect: true } },
                },
              },
            },
          },
        },
      },
      answers: {
        select: { questionId: true, response: true, isCorrect: true, marksAwarded: true, aiFeedback: true, evaluatedById: true },
      },
      submission: { select: { status: true, feedback: true, aiDraftFeedback: true } },
    },
  });
  if (!attempt) notFound();

  const byQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));

  const items = attempt.assessment.questions.map((item) => {
    const a = byQuestion.get(item.question.id);
    return {
      id: item.question.id,
      type: item.question.type,
      prompt: item.question.promptHtml,
      maxMarks: item.marks ?? item.question.marks,
      marksAwarded: a?.marksAwarded ?? null,
      isCorrect: a?.isCorrect ?? null,
      response: (a?.response ?? null) as unknown,
      ai: aiReport(a?.aiFeedback),
      options: item.question.options.map((o) => ({
        id: o.id,
        label: o.label,
        isCorrect: o.isCorrect,
      })),
    };
  });

  const aiDrafted = attempt.submission?.status === 'AI_DRAFTED';
  // An AI draft is a mark the trainer may still change; a published one is not.
  const done = attempt.status === 'EVALUATED' && !aiDrafted;

  const objectiveAwarded = items
    .filter((i) => i.options.length > 0)
    .reduce((n, i) => n + (i.marksAwarded ?? 0), 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link href="/admin/submissions" className="t-small faint hover:underline">
          Marking
        </Link>
        <h1 className="t-title mt-1 flex flex-wrap items-center gap-2">
          {attempt.user.name}
          {aiDrafted ? <Badge tone="brand">marked by the AI examiner</Badge> : attempt.status === 'EVALUATED' && <Badge tone="ok">marked</Badge>}
          {attempt.status === 'SUBMITTED' && <Badge tone="warn">waiting</Badge>}
        </h1>
        <p className="t-small faint mt-1">
          {attempt.assessment.title} · attempt {attempt.attemptNo}
          {attempt.submittedAt
            ? ` · submitted ${attempt.submittedAt.toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
              })}`
            : ''}
        </p>
        <p className="t-small faint mt-1 tabular-nums">
          Objective questions already scored {objectiveAwarded} marks automatically.
        </p>
      </div>

      <MarkForm
        attemptId={attempt.id}
        items={items}
        feedback={attempt.submission?.feedback ?? ''}
        aiDraft={aiDrafted ? (attempt.submission?.aiDraftFeedback ?? '') : ''}
        done={done}
      />
    </div>
  );
}

/** The examiner's stored report on one answer, with the scale it was marked on. */
function aiReport(value: unknown) {
  const evaluation = evaluationFromJson(value);
  if (!evaluation) return null;
  const presetKey = String((value as { preset?: string }).preset ?? '');
  const preset = presetFor(presetKey);
  const scale = preset?.scale ?? { min: 0, max: 100, step: 1, name: 'Percent' };
  const n = Number.isInteger(evaluation.overall) ? String(evaluation.overall) : evaluation.overall.toFixed(1);
  return {
    evaluation,
    scale,
    label: preset ? preset.label : 'Written answer',
    scoreLabel: scale.name === 'Band' ? `Band ${n}` : `${n} of ${scale.max}`,
  };
}
