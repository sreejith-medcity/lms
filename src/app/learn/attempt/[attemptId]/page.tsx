import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { deadlineFor } from '@/lib/attempt-clock';
import { displayOrder, parseAnswerKey, readSectionClock, sectionEndsAt, sectionState } from '@/lib/question-scoring';
import { Paper, type PaperQuestion, type PaperSection } from './paper';
import { Review } from './review';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function AttemptPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const attempt = await db.attempt.findFirst({
    where: {
      id: attemptId,
      userId: user.id,
      assessment: { organizationId: tenant.organizationId },
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      submittedAt: true,
      scoreRaw: true,
      scorePercent: true,
      passed: true,
      attemptNo: true,
      sectionClock: true,
      assessment: {
        select: {
          id: true,
          title: true,
          durationMinutes: true,
          passPercent: true,
          shuffleQuestions: true,
          showResultsImmediately: true,
          sections: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, instructions: true, durationMinutes: true } },
          questions: {
            orderBy: { sortOrder: 'asc' },
            select: {
              marks: true,
              sectionId: true,
              question: {
                select: {
                  id: true,
                  type: true,
                  promptHtml: true,
                  explanation: true,
                  marks: true,
                  negativeMarks: true,
                  answerKey: true,
                  mediaAssetId: true,
                  options: { orderBy: { sortOrder: 'asc' }, select: { id: true, label: true, isCorrect: true } },
                },
              },
            },
          },
        },
      },
      answers: {
        select: {
          questionId: true,
          response: true,
          isCorrect: true,
          marksAwarded: true,
        },
      },
      submission: { select: { status: true, feedback: true, score: true } },
    },
  });
  if (!attempt) notFound();

  const deadline = deadlineFor(attempt.startedAt, attempt.assessment.durationMinutes);

  // The kind of each picture or clip on the paper, in one query.
  const mediaIds = attempt.assessment.questions.map((q) => q.question.mediaAssetId).filter((id): id is string => Boolean(id));
  const mediaKinds = mediaIds.length
    ? await db.asset.findMany({ where: { id: { in: mediaIds }, organizationId: tenant.organizationId }, select: { id: true, type: true } })
    : [];
  const mediaFor = (assetId: string | null) => {
    if (!assetId) return null;
    const kind = mediaKinds.find((m) => m.id === assetId)?.type;
    return kind ? { url: `/api/assets/${assetId}`, kind } : null;
  };

  // A finished attempt is a review, never a paper.
  if (attempt.status !== 'IN_PROGRESS') {
    return (
      <Review
        attempt={{
          id: attempt.id,
          attemptNo: attempt.attemptNo,
          status: attempt.status,
          scorePercent: attempt.scorePercent,
          passed: attempt.passed,
          submittedAt: attempt.submittedAt?.toISOString() ?? null,
        }}
        assessment={{
          id: attempt.assessment.id,
          title: attempt.assessment.title,
          passPercent: attempt.assessment.passPercent,
          showResults: attempt.assessment.showResultsImmediately,
        }}
        feedback={attempt.submission?.feedback ?? null}
        awaitingMarking={attempt.status === 'SUBMITTED'}
        questions={attempt.assessment.questions.map((item) => {
          const answer = attempt.answers.find((a) => a.questionId === item.question.id);
          return {
            id: item.question.id,
            type: item.question.type,
            prompt: item.question.promptHtml,
            explanation: item.question.explanation,
            marks: item.marks ?? item.question.marks,
            marksAwarded: answer?.marksAwarded ?? null,
            isCorrect: answer?.isCorrect ?? null,
            response: (answer?.response ?? null) as unknown,
            answerKey: item.question.answerKey,
            media: mediaFor(item.question.mediaAssetId),
            options: item.question.options.map((o) => ({
              id: o.id,
              label: o.label,
              isCorrect: o.isCorrect,
            })),
          };
        })}
      />
    );
  }

  // Out of time while they were away: close it and come back as a review.
  if (deadline.expired) {
    const { submitAttempt } = await import('@/server/attempts');
    await submitAttempt(attempt.id, true);
    redirect(`/learn/attempt/${attempt.id}`);
  }

  // Options are shuffled per attempt so two people side by side do not share an
  // answer key, and the order is stable within one attempt by seeding on its id.
  const order = attempt.assessment.shuffleQuestions
    ? shuffle(attempt.assessment.questions, attempt.id)
    : attempt.assessment.questions;

  const clock = readSectionClock(attempt.sectionClock);
  const sections: PaperSection[] = attempt.assessment.sections.map((sec) => {
    const startedAt = clock[sec.id] ?? null;
    const s = { id: sec.id, durationMinutes: sec.durationMinutes, startedAt };
    return {
      id: sec.id,
      title: sec.title,
      instructions: sec.instructions,
      durationMinutes: sec.durationMinutes,
      startedAt: startedAt?.toISOString() ?? null,
      endsAt: sectionEndsAt(s)?.toISOString() ?? null,
      state: sectionState(s),
    };
  });

  const questions: PaperQuestion[] = order.map((item) => {
    const q = item.question;
    const key = parseAnswerKey(q.type, q.answerKey);
    const seed = `${attempt.id}:${q.id}`;
    return {
      id: q.id,
      type: q.type,
      prompt: q.promptHtml,
      marks: item.marks ?? q.marks,
      negative: q.negativeMarks,
      sectionId: item.sectionId,
      media: mediaFor(q.mediaAssetId),
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
      // The key never reaches the browser: only the shapes to draw.
      blanks: key?.kind === 'FILL_BLANK' ? key.blanks.length : 0,
      match:
        key?.kind === 'MATCH'
          ? { left: key.pairs.map((p) => p.left), right: displayOrder(key.pairs.length, seed).map((index) => ({ index, label: key.pairs[index].right })) }
          : null,
      ordering: key?.kind === 'ORDERING' ? displayOrder(key.items.length, seed).map((index) => ({ index, label: key.items[index] })) : null,
      saved: (attempt.answers.find((a) => a.questionId === q.id)?.response ?? null) as unknown,
    };
  });

  return (
    <Paper
      attemptId={attempt.id}
      title={attempt.assessment.title}
      endsAt={deadline.endsAt?.toISOString() ?? null}
      sections={sections}
      questions={questions}
    />
  );
}

/** Deterministic shuffle: same attempt, same order, every time the page loads. */
function shuffle<T>(items: T[], seed: string): T[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;

  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
