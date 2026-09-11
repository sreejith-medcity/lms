import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { anthropicReady, askClaude } from '@/lib/anthropic';
import { settingBool } from '@/lib/settings/store';
import {
  EXAM_PRESETS,
  evaluationSystemPrompt,
  evaluationUserPrompt,
  marksFromScale,
  parseEvaluation,
  presetFor,
  wordCount,
  type ExamPreset,
} from '@/lib/ai-evaluation';

/**
 * Marking the written half of an assessment without waiting for a trainer.
 *
 * Runs after a paper is submitted, only on assessments with AI evaluation
 * switched on. Each written answer is marked to the rubric named on the
 * question (`rubric.exam`, one of the presets) or, failing that, to a
 * generic rubric built from the question's own marks. The marks are
 * written as the result and the examiner's notes kept beside each answer;
 * the submission is left AI_DRAFTED so the trainer's screen shows it as
 * marked by the examiner and lets them change it.
 */

const GENERIC: ExamPreset = {
  key: 'GENERIC',
  kind: 'WRITING',
  label: 'Written answer',
  blurb: '',
  scale: { min: 0, max: 100, step: 1, name: 'Percent' },
  criteria: [
    { key: 'ACCURACY', name: 'Accuracy and completeness', describes: 'Answers what was asked, correctly and fully.' },
    { key: 'REASONING', name: 'Reasoning', describes: 'Shows how the answer was reached where that matters.' },
    { key: 'CLARITY', name: 'Clarity', describes: 'Organised and readable.' },
  ],
  length: 'as the question requires',
  language: 'en',
  pass: 40,
};

function presetFromRubric(rubric: unknown): ExamPreset {
  const r = (rubric ?? {}) as { exam?: string; modelAnswer?: string };
  return (r.exam && presetFor(r.exam)) || GENERIC;
}

export async function evaluateAttemptWriting(attemptId: string): Promise<{ marked: number; skipped: number }> {
  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      userId: true,
      status: true,
      scoreRaw: true,
      assessment: {
        select: {
          organizationId: true,
          aiEvaluation: true,
          passPercent: true,
          questions: { select: { marks: true, question: { select: { id: true, type: true, marks: true } } } },
        },
      },
      answers: {
        select: { id: true, questionId: true, response: true, marksAwarded: true, question: { select: { type: true, promptHtml: true, rubric: true, marks: true } } },
      },
    },
  });
  if (!attempt || attempt.status !== 'SUBMITTED' || !attempt.assessment.aiEvaluation) return { marked: 0, skipped: 0 };

  const organizationId = attempt.assessment.organizationId;
  if (!(await settingBool(organizationId, 'ai.autoMarkWriting'))) return { marked: 0, skipped: 0 };
  if (!(await anthropicReady(organizationId))) return { marked: 0, skipped: 0 };

  const marksFor = new Map(attempt.assessment.questions.map((q) => [q.question.id, q.marks ?? q.question.marks]));
  const written = attempt.answers.filter((a) => a.question.type === 'SHORT_ANSWER' || a.question.type === 'LONG_ANSWER');

  let marked = 0;
  let skipped = 0;
  let awarded = attempt.scoreRaw ?? 0;
  const notes: string[] = [];

  for (const answer of written) {
    const text = typeof answer.response === 'string' ? answer.response : JSON.stringify(answer.response ?? '');
    if (!text.trim()) {
      skipped += 1;
      continue;
    }
    const preset = presetFromRubric(answer.question.rubric);
    const rubric = (answer.question.rubric ?? {}) as { modelAnswer?: string; notes?: string };
    const task = [answer.question.promptHtml.replace(/<[^>]+>/g, ' '), rubric.modelAnswer ? `\nMODEL ANSWER (for the examiner only): ${rubric.modelAnswer}` : '', rubric.notes ? `\nMARKING NOTES: ${rubric.notes}` : ''].join('');

    try {
      const reply = await askClaude({
        organizationId,
        system: evaluationSystemPrompt(preset),
        user: evaluationUserPrompt({ task, answer: text, wordCount: wordCount(text) }),
        purpose: 'Marked a written answer',
      });
      const parsed = parseEvaluation(reply.text, preset);
      if (!parsed.ok) {
        skipped += 1;
        continue;
      }
      const marks = marksFromScale(preset, parsed.evaluation.overall, marksFor.get(answer.questionId) ?? answer.question.marks);
      await db.answer.update({
        where: { id: answer.id },
        data: {
          marksAwarded: marks,
          aiFeedback: { preset: preset.key, ...parsed.evaluation } as unknown as Prisma.InputJsonValue,
        },
      });
      awarded += marks;
      marked += 1;
      notes.push(`${preset.label}: ${parsed.evaluation.overall} ${preset.scale.name}. ${parsed.evaluation.summary}`);
    } catch {
      skipped += 1;
    }
  }

  if (marked === 0) return { marked, skipped };

  // Written and objective marks together, the same arithmetic the trainer's
  // screen uses, so the two never disagree about a percentage.
  const paperTotal = attempt.assessment.questions.reduce((n, q) => n + (q.marks ?? q.question.marks), 0);
  const scorePercent = paperTotal > 0 ? Math.max(0, (awarded / paperTotal) * 100) : 0;
  const allMarked = skipped === 0;

  await db.$transaction([
    db.attempt.update({
      where: { id: attempt.id },
      data: allMarked
        ? { status: 'EVALUATED', scoreRaw: awarded, scorePercent: Math.round(scorePercent * 10) / 10, passed: scorePercent >= attempt.assessment.passPercent }
        : { scoreRaw: awarded },
    }),
    db.submission.updateMany({
      where: { attemptId: attempt.id },
      data: {
        status: allMarked ? 'AI_DRAFTED' : 'NOT_EVALUATED',
        score: allMarked ? Math.round(scorePercent * 10) / 10 : undefined,
        aiDraftFeedback: notes.join('\n\n'),
        evaluatedAt: allMarked ? new Date() : undefined,
      },
    }),
  ]);

  return { marked, skipped };
}

export { EXAM_PRESETS };
