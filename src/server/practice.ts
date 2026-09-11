'use server';

import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { anthropicReady, askClaude } from '@/lib/anthropic';
import { settingBool } from '@/lib/settings/store';
import { practiceAllowance } from '@/lib/ai-practice';
import {
  evaluationSystemPrompt,
  evaluationUserPrompt,
  isPass,
  parseEvaluation,
  parseTask,
  presetFor,
  scoreLabel,
  taskSystemPrompt,
  wordCount,
  type ExamPreset,
} from '@/lib/ai-evaluation';

/**
 * Practising with the AI examiner.
 *
 * Two calls: one for a task, one for a mark. Each is a paid model call, so
 * there is a daily allowance per learner (a setting), counted over the
 * last twenty-four hours rather than a calendar day so that midnight in
 * whichever timezone the server sits in does not hand out a fresh batch.
 * The task text the learner answered is stored with the answer, whether
 * the examiner wrote it or the learner pasted their own, so the report
 * makes sense a month later.
 */

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const RESPONSE_MAX = 12_000;
const TASK_MAX = 4_000;

async function context(examKey: string): Promise<{ organizationId: string; userId: string; preset: ExamPreset }> {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) throw new Error('SIGN_IN_REQUIRED');
  const preset = presetFor(examKey);
  if (!preset) throw new Error('UNKNOWN_EXAM');
  if (!(await settingBool(tenant.organizationId, 'ai.practiceEnabled'))) throw new Error('PRACTICE_OFF');
  if (!(await anthropicReady(tenant.organizationId))) throw new Error('ANTHROPIC_NOT_CONNECTED');
  return { organizationId: tenant.organizationId, userId: user.id, preset };
}

function explain(err: unknown): string {
  const code = err instanceof Error ? err.message : String(err);
  switch (code) {
    case 'SIGN_IN_REQUIRED':
      return 'Please sign in again.';
    case 'UNKNOWN_EXAM':
      return 'That exam is not one we practise here.';
    case 'PRACTICE_OFF':
      return 'Practice is switched off for now.';
    case 'ANTHROPIC_NOT_CONNECTED':
      return 'The AI examiner is not connected yet. The academy needs to add its Anthropic key under Integrations.';
    case 'ANTHROPIC_UNREACHABLE':
      return 'Could not reach the examiner. Check your connection and try again.';
    case 'ANTHROPIC_429':
      return 'The examiner is busy. Give it a minute and try again.';
    case 'ANTHROPIC_401':
    case 'ANTHROPIC_403':
      return 'The Anthropic key is not being accepted. Tell the academy.';
    case 'ALLOWANCE_USED':
      return 'You have used today’s practice attempts. They come back over the next day.';
    default:
      return code.startsWith('ANTHROPIC_') ? 'The examiner returned an error. Try again in a minute.' : 'Something went wrong. Try again.';
  }
}

/** A fresh task in the style of the exam. */
export async function newPracticeTask(examKey: string): Promise<Result<{ title: string; task: string }>> {
  try {
    const { organizationId, userId, preset } = await context(examKey);
    const allowance = await practiceAllowance(organizationId, userId);
    if (allowance.used >= allowance.limit) throw new Error('ALLOWANCE_USED');

    // A different seed each time, or the model settles on the same three topics.
    const seed = ['health', 'cities', 'work', 'family', 'technology', 'education', 'travel', 'environment', 'money', 'food', 'sport', 'media'][Math.floor(Math.random() * 12)];
    const reply = await askClaude({
      organizationId,
      system: taskSystemPrompt(preset),
      user: `Write one new task. Loosely around the theme "${seed}" unless that does not suit the exam, in which case pick any suitable topic. Task number ${Math.floor(Math.random() * 1000)}.`,
      maxTokens: 700,
      purpose: `Wrote a ${preset.label} task`,
    });
    const task = parseTask(reply.text);
    if (!task) return { ok: false, error: 'The examiner did not hand back a usable task. Try again.' };
    return { ok: true, ...task };
  } catch (err) {
    return { ok: false, error: explain(err) };
  }
}

/** The answer goes to the examiner and the report is stored. */
export async function submitPractice(input: {
  examKey: string;
  task: string;
  response: string;
  durationSeconds?: number | null;
}): Promise<Result<{ attemptId: string }>> {
  try {
    const { organizationId, userId, preset } = await context(input.examKey);

    const task = String(input.task ?? '').trim().slice(0, TASK_MAX);
    const response = String(input.response ?? '').trim().slice(0, RESPONSE_MAX);
    if (!task) return { ok: false, error: 'There is no task to answer. Ask for one, or paste your own.' };
    const words = wordCount(response);
    const minimum = preset.kind === 'SPEAKING' ? 15 : 40;
    if (words < minimum) {
      return {
        ok: false,
        error: preset.kind === 'SPEAKING' ? 'Say a little more first; the examiner needs at least a few sentences.' : `Write a little more first; the examiner needs at least ${minimum} words to mark.`,
      };
    }

    const allowance = await practiceAllowance(organizationId, userId);
    if (allowance.used >= allowance.limit) throw new Error('ALLOWANCE_USED');

    const duration =
      typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)
        ? Math.max(0, Math.min(7200, Math.round(input.durationSeconds)))
        : null;

    const reply = await askClaude({
      organizationId,
      system: evaluationSystemPrompt(preset),
      user: evaluationUserPrompt({ task, answer: response, wordCount: words, durationSeconds: preset.kind === 'SPEAKING' ? duration : null }),
      maxTokens: 2000,
      purpose: `Marked ${preset.label} practice`,
    });
    const parsed = parseEvaluation(reply.text, preset);
    if (!parsed.ok) return { ok: false, error: parsed.error + ' Try again.' };

    const attempt = await db.practiceAttempt.create({
      data: {
        organizationId,
        userId,
        kind: preset.kind,
        exam: preset.key,
        prompt: task,
        response,
        score: parsed.evaluation.overall,
        scoreLabel: scoreLabel(preset, parsed.evaluation.overall),
        evaluation: {
          preset: preset.key,
          pass: isPass(preset, parsed.evaluation.overall),
          words,
          ...parsed.evaluation,
        } as unknown as Prisma.InputJsonValue,
        durationSeconds: duration,
      },
      select: { id: true },
    });

    return { ok: true, attemptId: attempt.id };
  } catch (err) {
    return { ok: false, error: explain(err) };
  }
}
