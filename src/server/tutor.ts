'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser, requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { anthropicReady } from '@/lib/anthropic';
import { settingBool } from '@/lib/settings/store';
import { entitledToLesson, lessonFail } from '@/lib/lesson-entitlement';
import { TUTOR_QUESTION_MAX, type Citation } from '@/lib/tutor';
import { askTheTutor, draftQuiz, summariseLesson, tutorAllowance } from '@/lib/tutor-data';
import type { ActionState } from '@/server/courses';

/**
 * The tutor (a learner asks from the lesson) and the lesson tools (staff
 * summarise a lesson, or draft a quiz from it into a question bank).
 */

export type TutorReply = ActionState & { answer?: string; citations?: Citation[]; left?: number };

export async function askTutor(_prev: TutorReply, formData: FormData): Promise<TutorReply> {
  try {
    const materialId = String(formData.get('materialId') ?? '');
    const question = String(formData.get('question') ?? '').trim().slice(0, TUTOR_QUESTION_MAX);
    if (question.length < 3) return { error: 'Ask something first.' };

    const { tenant, user, enrollment, courseId } = await entitledToLesson(materialId);
    if (!courseId) return { error: 'This lesson is not part of a course.' };
    if (!(await settingBool(tenant.organizationId, 'ai.tutorEnabled'))) return { error: 'The tutor is switched off for this academy.' };
    if (!(await anthropicReady(tenant.organizationId))) return { error: 'The tutor is not connected yet. Ask your trainer in the Q&A tab.' };

    const allowance = await tutorAllowance(tenant.organizationId, user.id);
    if (allowance.used >= allowance.limit) {
      return { error: `You have asked the tutor ${allowance.limit} times today. It is back tomorrow; your trainer is in the Q&A tab meanwhile.` };
    }

    const [org, product] = await Promise.all([
      db.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true } }),
      db.product.findUnique({ where: { id: enrollment.productId }, select: { title: true } }),
    ]);

    const reply = await askTheTutor({
      organizationId: tenant.organizationId,
      academy: org?.name ?? 'the academy',
      userId: user.id,
      courseId,
      courseTitle: product?.title ?? 'this course',
      materialId,
      question,
    });
    return { ok: true, answer: reply.answer, citations: reply.citations, left: allowance.limit - allowance.used - 1 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('ANTHROPIC_')) return { error: 'The tutor could not be reached just now. Try again in a moment.' };
    return lessonFail('tutor', err);
  }
}

async function tools() {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('asset_library.manage_assets', 'edit')]);
  if (!(await anthropicReady(tenant.organizationId))) throw new Error('ANTHROPIC_NOT_CONNECTED');
  return { tenant, user };
}

function toolFail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'ANTHROPIC_NOT_CONNECTED') return { error: 'Add the Anthropic key under Integrations first.' };
  if (message.startsWith('ANTHROPIC_')) return { error: 'The model could not be reached just now. Try again in a moment.' };
  if (message === 'UNAUTHORIZED' || message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[tutor]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/** Summary, chapters and key terms written onto the transcript. */
export async function summariseAsset(assetId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await tools();
    const result = await summariseLesson(tenant.organizationId, assetId);
    if (!result) return { error: 'This file needs a transcript first.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'transcript.summarised', entity: 'Asset', entityId: assetId, after: { chapters: result.chapters.length } });
    revalidatePath('/admin/library');
    return { ok: true, message: `Summary written, ${result.chapters.length} chapters, ${result.keyTerms.length} key terms.` };
  } catch (err) {
    return toolFail(err);
  }
}

/** Questions drafted from the lesson, added to a bank tagged with the lesson's name. */
export async function quizFromAsset(assetId: string, bankId: string, count: number): Promise<ActionState> {
  try {
    const { tenant, user } = await tools();
    const bank = await db.questionBank.findFirst({ where: { id: bankId, organizationId: tenant.organizationId }, select: { id: true, name: true } });
    if (!bank) return { error: 'Pick a question bank.' };

    const drafted = await draftQuiz(tenant.organizationId, assetId, count);
    if (!drafted) return { error: 'This file needs a transcript first.' };
    if (drafted.questions.length === 0) return { error: 'The model wrote nothing usable. Try again.' };

    const tag = drafted.lessonTitle.slice(0, 60);
    await db.$transaction(
      drafted.questions.map((q) =>
        db.question.create({
          data: {
            bankId: bank.id,
            type: 'MCQ_SINGLE',
            promptHtml: q.prompt,
            explanation: q.explanation || null,
            difficulty: q.difficulty,
            marks: 1,
            tags: [tag, 'drafted by AI'],
            options: { create: q.options.map((label, sortOrder) => ({ label, isCorrect: sortOrder === q.answer, sortOrder })) },
          },
          select: { id: true },
        }),
      ),
    );
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'question_bank.ai_drafted', entity: 'QuestionBank', entityId: bank.id, after: { from: assetId, count: drafted.questions.length } });
    revalidatePath(`/admin/question-bank/${bank.id}`);
    return { ok: true, message: `${drafted.questions.length} questions added to ${bank.name}, tagged "${tag}" and "drafted by AI". Read them before they go in a paper.` };
  } catch (err) {
    return toolFail(err);
  }
}
