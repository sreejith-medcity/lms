'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff, getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import type { ActionState } from '@/server/courses';
import {
  FORM_TYPES,
  QUESTION_TYPES,
  questionsOf,
  type FeedbackQuestion,
  type QuestionType,
} from '@/lib/feedback';

/**
 * Feedback forms, and the answers to them.
 *
 * A form is a list of questions stored as JSON rather than a table per form,
 * because an institute writes a new one every term and none of them outlive the
 * term. What has to be queryable is the rating and who answered, so those two
 * are real columns and the rest is the blob.
 */


async function guard(
  action: 'view' | 'edit' | 'delete' = 'edit',
  permission = 'feedback_form.manage_forms',
) {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[feedback]', message);
  return { error: 'Something went wrong. Please try again.' };
}

function slugKey(label: string, index: number) {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return base ? `${base}_${index}` : `q${index}`;
}

/** Questions arrive as parallel arrays from the form, one row per question. */
function readQuestions(formData: FormData): FeedbackQuestion[] {
  const labels = formData.getAll('questionLabel').map(String);
  const types = formData.getAll('questionType').map(String);
  const options = formData.getAll('questionOptions').map(String);
  const required = formData.getAll('questionRequired').map(String);

  return labels
    .map((label, i) => ({ label: label.trim(), i }))
    .filter((q) => q.label.length > 0)
    .map(({ label, i }) => {
      const type = (QUESTION_TYPES as readonly string[]).includes(types[i])
        ? (types[i] as QuestionType)
        : 'TEXT';
      return {
        key: slugKey(label, i),
        label: label.slice(0, 200),
        type,
        options:
          type === 'CHOICE'
            ? (options[i] ?? '')
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
                .slice(0, 12)
            : undefined,
        required: required[i] === 'on' || required[i] === 'true',
      };
    })
    .slice(0, 30);
}

const formShape = z.object({
  name: z.string().trim().min(2, 'Give the form a name').max(120),
  type: z.enum(FORM_TYPES),
});

export async function createFeedbackForm(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { id?: string }> {
  try {
    const { tenant, user } = await guard();

    const parsed = formShape.safeParse({
      name: formData.get('name'),
      type: formData.get('type') || 'SESSION',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const questions = readQuestions(formData);
    if (questions.length === 0) return { error: 'Add at least one question.' };

    const created = await db.feedbackForm.create({
      data: {
        organizationId: tenant.organizationId,
        name: parsed.data.name,
        type: parsed.data.type,
        questions: questions as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'feedback.form.created',
      entity: 'FeedbackForm',
      entityId: created.id,
      after: { name: parsed.data.name, questions: questions.length },
    });

    revalidatePath('/admin/feedback');
    return { ok: true, id: created.id, message: 'Form created.' };
  } catch (err) {
    return fail(err);
  }
}

export async function updateFeedbackForm(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const id = String(formData.get('id') ?? '');
    const parsed = formShape.safeParse({
      name: formData.get('name'),
      type: formData.get('type') || 'SESSION',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const form = await db.feedbackForm.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, _count: { select: { responses: true } } },
    });
    if (!form) return { error: 'Form not found.' };

    const questions = readQuestions(formData);
    if (questions.length === 0) return { error: 'Add at least one question.' };

    // Rewriting questions under answers already given would leave those answers
    // pointing at labels nobody wrote. The name and state stay editable.
    const data: Prisma.FeedbackFormUpdateInput =
      form._count.responses > 0
        ? { name: parsed.data.name }
        : {
            name: parsed.data.name,
            type: parsed.data.type,
            questions: questions as unknown as Prisma.InputJsonValue,
          };

    await db.feedbackForm.update({ where: { id }, data });

    revalidatePath('/admin/feedback');
    revalidatePath(`/admin/feedback/${id}`);
    return {
      ok: true,
      message:
        form._count.responses > 0
          ? 'Name saved. The questions are locked because people have already answered them.'
          : 'Saved.',
    };
  } catch (err) {
    return fail(err);
  }
}

export async function setFeedbackFormActive(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const form = await db.feedbackForm.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!form) return { error: 'Form not found.' };

    await db.feedbackForm.update({ where: { id }, data: { isActive } });

    revalidatePath('/admin/feedback');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteFeedbackForm(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');

    const form = await db.feedbackForm.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, _count: { select: { responses: true } } },
    });
    if (!form) return { error: 'Form not found.' };

    // Answers are what people said. Retiring the form keeps them readable.
    if (form._count.responses > 0) {
      return {
        error: `This form holds ${form._count.responses} answers. Switch it off instead of deleting it.`,
      };
    }

    await db.feedbackForm.delete({ where: { id } });

    revalidatePath('/admin/feedback');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* The learner's side -------------------------------------------------------- */

/**
 * One answer per person per class.
 *
 * Rating a class you did not attend is noise, so the sitting is checked first,
 * and a second submission edits the first rather than stacking a duplicate onto
 * the average.
 */
export async function submitFeedback(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };

    const formId = String(formData.get('formId') ?? '');
    const sessionId = String(formData.get('sessionId') ?? '') || null;

    const form = await db.feedbackForm.findFirst({
      where: { id: formId, organizationId: tenant.organizationId, isActive: true },
      select: { id: true, questions: true },
    });
    if (!form) return { error: 'That form is closed.' };

    let batchId: string | null = null;
    if (sessionId) {
      const session = await db.liveSession.findFirst({
        where: { id: sessionId, organizationId: tenant.organizationId },
        select: { id: true, batchId: true, startsAt: true },
      });
      if (!session) return { error: 'That class is not available.' };
      if (session.startsAt > new Date()) return { error: 'That class has not happened yet.' };

      const enrolled = await db.enrollment.findFirst({
        where: { userId: user.id, batchId: session.batchId },
        select: { id: true },
      });
      if (!enrolled) return { error: 'You are not in that batch.' };

      batchId = session.batchId;
    }

    const questions = questionsOf(form.questions);
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const value = String(formData.get(`q_${q.key}`) ?? '').trim();
      if (q.required && !value) return { error: `${q.label} is required.` };
      if (value) answers[q.key] = value.slice(0, 2000);
    }

    const ratingRaw = Number(formData.get('rating') ?? 0);
    const rating = Number.isFinite(ratingRaw) && ratingRaw > 0 ? Math.min(5, ratingRaw) : null;

    const existing = sessionId
      ? await db.feedbackResponse.findFirst({
          where: { formId: form.id, userId: user.id, sessionId },
          select: { id: true },
        })
      : null;

    if (existing) {
      await db.feedbackResponse.update({
        where: { id: existing.id },
        data: { rating, answers },
      });
    } else {
      await db.feedbackResponse.create({
        data: { formId: form.id, userId: user.id, sessionId, batchId, rating, answers },
      });
    }

    revalidatePath('/learn');
    revalidatePath(`/admin/feedback/${form.id}`);
    return { ok: true, message: 'Thank you. That goes straight to the team.' };
  } catch (err) {
    return fail(err);
  }
}
