'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { happened, notifyLearner } from '@/lib/events';
import { entitledToLesson, lessonFail } from '@/lib/lesson-entitlement';
import { answerProblem, canWithdraw, questionProblem, toTell, toggleAlsoAsking, QUESTION_MAX, ANSWER_MAX } from '@/lib/lesson-qa';
import type { ActionState } from '@/server/courses';

/**
 * Questions on a lesson.
 *
 * A learner asks from the lesson page; the trainer answers from the queue or
 * from the same tab. The batch sees the exchange, everyone who pressed "me
 * too" is told when the answer lands, and a pinned question sits at the top
 * for the next batch.
 */

/** Trainers answer and tidy: whoever moderates discussions or manages courses. */
async function requireAnswerer() {
  const user = await getSessionUser();
  if (!user || user.kind !== 'STAFF') throw new Error('UNAUTHORIZED');
  const ok =
    user.permissions['discussions.moderate_discussions']?.edit ||
    user.permissions['courses.course_management']?.edit;
  if (!ok) throw new Error('FORBIDDEN');
  return user;
}

const fail = (err: unknown) => lessonFail('lesson-questions', err);

async function refreshLesson(courseId: string, materialId: string) {
  const course = await db.course.findUnique({ where: { id: courseId }, select: { productId: true } });
  if (course) revalidatePath(`/learn/${course.productId}/${materialId}`);
  revalidatePath('/admin/questions');
  return course?.productId ?? null;
}

export async function askQuestion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const materialId = String(formData.get('materialId') ?? '');
    const body = String(formData.get('body') ?? '').trim();
    const rawAt = String(formData.get('atSeconds') ?? '');

    const problem = questionProblem(body);
    if (problem) return { error: problem };

    const { tenant, user, enrollment, courseId } = await entitledToLesson(materialId);
    if (!courseId) return { error: 'This lesson is not part of a course.' };

    const atSeconds = rawAt ? Math.max(0, Math.round(Number(rawAt))) : null;

    const question = await db.lessonQuestion.create({
      data: {
        organizationId: tenant.organizationId,
        materialId,
        courseId,
        batchId: enrollment.batchId,
        userId: user.id,
        body: body.slice(0, QUESTION_MAX),
        atSeconds: Number.isFinite(atSeconds) ? atSeconds : null,
      },
      select: { id: true, material: { select: { title: true } } },
    });

    await happened({
      organizationId: tenant.organizationId,
      key: 'lesson_question.asked',
      userId: user.id,
      subjectId: question.id,
      productId: enrollment.productId,
      batchId: enrollment.batchId ?? undefined,
      data: { questionId: question.id, materialId, item: question.material.title, body },
    });

    revalidatePath(`/learn/${enrollment.productId}/${materialId}`);
    revalidatePath('/admin/questions');
    return { ok: true, message: 'Asked. Your trainer will be told.' };
  } catch (err) {
    return fail(err);
  }
}

/** "I have this question too": counts the learner in, or out again. */
export async function alsoAsk(questionId: string): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const question = await db.lessonQuestion.findFirst({
      where: { id: questionId, organizationId: tenant.organizationId, isHidden: false },
      select: { id: true, materialId: true, userId: true, alsoAsking: true, answeredAt: true },
    });
    if (!question) throw new Error('NOT_FOUND');
    if (question.answeredAt) return { error: 'This one has been answered already.' };

    const { user, enrollment } = await entitledToLesson(question.materialId);
    const next = toggleAlsoAsking(question.alsoAsking, user.id, question.userId);
    if (next !== question.alsoAsking) {
      await db.lessonQuestion.update({ where: { id: question.id }, data: { alsoAsking: next } });
    }
    revalidatePath(`/learn/${enrollment.productId}/${question.materialId}`);
    revalidatePath('/admin/questions');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** The asker takes an unanswered question back. */
export async function withdrawQuestion(questionId: string): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) throw new Error('SIGN_IN_REQUIRED');
    const question = await db.lessonQuestion.findFirst({
      where: { id: questionId, organizationId: tenant.organizationId },
      select: { id: true, materialId: true, courseId: true, userId: true, answeredAt: true },
    });
    if (!question) throw new Error('NOT_FOUND');
    if (!canWithdraw(question, user.id)) return { error: 'Only an unanswered question of your own can be taken back.' };

    await db.lessonQuestion.delete({ where: { id: question.id } });
    await refreshLesson(question.courseId, question.materialId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function answerQuestion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const questionId = String(formData.get('questionId') ?? '');
    const answer = String(formData.get('answer') ?? '').trim();
    const pin = formData.get('pin') === 'on';

    const problem = answerProblem(answer);
    if (problem) return { error: problem };

    const tenant = await requireTenant();
    const me = await requireAnswerer();

    const question = await db.lessonQuestion.findFirst({
      where: { id: questionId, organizationId: tenant.organizationId },
      select: {
        id: true,
        materialId: true,
        courseId: true,
        userId: true,
        alsoAsking: true,
        answeredAt: true,
        material: { select: { title: true } },
      },
    });
    if (!question) throw new Error('NOT_FOUND');

    const firstAnswer = !question.answeredAt;
    await db.lessonQuestion.update({
      where: { id: question.id },
      data: {
        answer: answer.slice(0, ANSWER_MAX),
        answeredById: me.id,
        answeredAt: firstAnswer ? new Date() : undefined,
        isPinned: pin ? true : undefined,
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: me.id,
      action: firstAnswer ? 'lesson_question.answered' : 'lesson_question.edited',
      entity: 'LessonQuestion',
      entityId: question.id,
      after: { learner: question.userId, pinned: pin },
    });

    const productId = await refreshLesson(question.courseId, question.materialId);

    // Tell the people waiting, once, the first time. An edited answer is not news.
    if (firstAnswer && productId) {
      const course = await db.course.findUnique({
        where: { id: question.courseId },
        select: { product: { select: { title: true } } },
      });
      const url = `/learn/${productId}/${question.materialId}?tab=qa`;
      await happened({
        organizationId: tenant.organizationId,
        key: 'lesson_question.answered',
        userId: question.userId,
        subjectId: question.id,
        productId,
        data: { questionId: question.id, materialId: question.materialId, item: question.material.title, answeredBy: me.name ?? '' },
      });
      for (const userId of toTell(question)) {
        await notifyLearner({
          organizationId: tenant.organizationId,
          eventKey: 'lesson_question.answered',
          userId,
          subjectId: `${question.id}:${userId}`,
          context: {
            item: question.material.title,
            course: course?.product.title ?? '',
            trainer: me.name ?? 'Your trainer',
            url,
          },
        });
      }
    }

    return { ok: true, message: firstAnswer ? 'Answered. The learners waiting have been told.' : 'Answer updated.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setQuestionPinned(questionId: string, pinned: boolean): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    await requireAnswerer();
    const question = await db.lessonQuestion.findFirst({
      where: { id: questionId, organizationId: tenant.organizationId },
      select: { id: true, materialId: true, courseId: true },
    });
    if (!question) throw new Error('NOT_FOUND');
    await db.lessonQuestion.update({ where: { id: question.id }, data: { isPinned: pinned } });
    await refreshLesson(question.courseId, question.materialId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Hidden, not deleted: the asker's words stay on record, the batch stops seeing them. */
export async function setQuestionHidden(questionId: string, hidden: boolean): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const me = await requireAnswerer();
    const question = await db.lessonQuestion.findFirst({
      where: { id: questionId, organizationId: tenant.organizationId },
      select: { id: true, materialId: true, courseId: true },
    });
    if (!question) throw new Error('NOT_FOUND');
    await db.lessonQuestion.update({ where: { id: question.id }, data: { isHidden: hidden, isPinned: hidden ? false : undefined } });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: me.id,
      action: hidden ? 'lesson_question.hidden' : 'lesson_question.restored',
      entity: 'LessonQuestion',
      entityId: question.id,
    });
    await refreshLesson(question.courseId, question.materialId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
