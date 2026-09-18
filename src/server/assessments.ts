'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { buildObjectKey, inferType, putObject, sanitiseFileName } from '@/lib/storage';
import { KEYED, keyProblem, parseAnswerKey } from '@/lib/question-scoring';
import type { ActionState } from '@/server/courses';

/**
 * Question banks, questions and assessments.
 *
 * Two rules run through all of it. Questions live in a bank and are reused
 * across assessments, the same way modules are reused across courses, because a
 * good OET reading question is worth more than the paper it was written for.
 * And a published assessment with attempts against it is versioned rather than
 * edited, so a score always means what it meant on the day it was earned.
 */

async function guard(permission: string, action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[assessments]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/* Banks ------------------------------------------------------------------- */

export async function createBank(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('question_bank.manage_banks');

    const name = String(formData.get('name') ?? '').trim();
    if (name.length < 2) return { error: 'Give the bank a name.' };

    const bank = await db.questionBank.create({
      data: {
        organizationId: tenant.organizationId,
        name,
        exam: String(formData.get('exam') ?? '').trim() || null,
        subject: String(formData.get('subject') ?? '').trim() || null,
        topic: String(formData.get('topic') ?? '').trim() || null,
      },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'question_bank.created',
      entity: 'QuestionBank',
      entityId: bank.id,
      after: { name },
    });

    revalidatePath('/admin/question-bank');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteBank(bankId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('question_bank.manage_banks', 'delete');

    const bank = await db.questionBank.findFirst({
      where: { id: bankId, organizationId: tenant.organizationId },
      select: { _count: { select: { questions: true } } },
    });
    if (!bank) return { error: 'Bank not found.' };
    if (bank._count.questions > 0) {
      return { error: `This bank holds ${bank._count.questions} questions. Empty it first.` };
    }

    await db.questionBank.delete({ where: { id: bankId } });
    revalidatePath('/admin/question-bank');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Questions --------------------------------------------------------------- */

const OBJECTIVE = ['MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE'] as const;
const SUPPORTED = ['MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'FILL_BLANK', 'MATCH', 'ORDERING', 'SHORT_ANSWER', 'LONG_ANSWER', 'FILE_UPLOAD', 'SPEAKING'] as const;

export type SupportedQuestionType = (typeof SUPPORTED)[number];

const MEDIA_MAX = 25 * 1024 * 1024;

/**
 * The key for a blank, match or ordering question, from the editor's own
 * fields: one line per blank with accepted answers separated by |, one
 * pair per line as left = right, one item per line in the right order.
 */
function keyFromForm(type: string, formData: FormData): unknown {
  const lines = (name: string) =>
    String(formData.get(name) ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  if (type === 'FILL_BLANK') {
    return { blanks: lines('blanks').map((l) => l.split('|').map((v) => v.trim()).filter(Boolean)), caseSensitive: formData.get('caseSensitive') === 'on' };
  }
  if (type === 'MATCH') {
    return {
      pairs: lines('pairs').map((l) => {
        const at = l.indexOf('=');
        return at < 0 ? { left: l, right: '' } : { left: l.slice(0, at).trim(), right: l.slice(at + 1).trim() };
      }),
    };
  }
  if (type === 'ORDERING') return { items: lines('items') };
  return null;
}

const question = z.object({
  bankId: z.string().min(1),
  type: z.enum(SUPPORTED),
  promptHtml: z.string().trim().min(3, 'Write the question'),
  explanation: z.string().trim().max(2000).optional().or(z.literal('')),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  marks: z.coerce.number().min(0.25).max(100),
  negativeMarks: z.coerce.number().min(0).max(100),
  tags: z.string().trim().max(200).optional().or(z.literal('')),
});

export async function saveQuestion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('question_bank.manage_questions');

    const parsed = question.safeParse({
      bankId: formData.get('bankId'),
      type: formData.get('type'),
      promptHtml: formData.get('promptHtml'),
      explanation: formData.get('explanation') || '',
      difficulty: formData.get('difficulty') || 'MEDIUM',
      marks: formData.get('marks') || 1,
      negativeMarks: formData.get('negativeMarks') || 0,
      tags: formData.get('tags') || '',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const bank = await db.questionBank.findFirst({
      where: { id: d.bankId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!bank) return { error: 'Bank not found.' };

    // Options arrive as option[0], option[1]... with correct[] holding the ticked ones.
    const labels = formData.getAll('option').map((v) => String(v).trim());
    const correct = new Set(formData.getAll('correct').map((v) => String(v)));

    const isObjective = (OBJECTIVE as readonly string[]).includes(d.type);
    const isKeyed = (KEYED as string[]).includes(d.type);
    const takesNegative = isObjective || isKeyed;

    let answerKey: unknown = null;
    if (isKeyed) {
      answerKey = keyFromForm(d.type, formData);
      const problem = keyProblem(d.type, d.promptHtml, parseAnswerKey(d.type, answerKey));
      if (problem) return { error: problem };
    }

    // A picture or a clip on the question. Any image, audio or video.
    let mediaAssetId: string | null = null;
    const media = formData.get('media');
    if (media instanceof File && media.size > 0) {
      if (media.size > MEDIA_MAX) return { error: 'Keep the picture or clip under 25 MB. Longer video belongs in the media library.' };
      const kind = inferType(media.name || 'file');
      if (!['IMAGE', 'AUDIO', 'VIDEO'].includes(kind)) return { error: 'The question can carry a picture, an audio clip or a video, not a document.' };
      const fileName = sanitiseFileName(media.name || 'media');
      const key = buildObjectKey(tenant.organizationId, fileName);
      await putObject(key, new Uint8Array(await media.arrayBuffer()), media.type || 'application/octet-stream');
      const asset = await db.asset.create({
        data: {
          organizationId: tenant.organizationId,
          name: `Question media: ${fileName}`,
          fileName,
          type: kind,
          storageKey: key,
          mimeType: media.type || null,
          sizeBytes: BigInt(media.size),
          uploadedById: user.id,
          transcodeStatus: 'READY',
        },
        select: { id: true },
      });
      mediaAssetId = asset.id;
    }

    let options: { label: string; isCorrect: boolean; sortOrder: number }[] = [];

    if (d.type === 'TRUE_FALSE') {
      const answer = String(formData.get('trueFalse') ?? 'true');
      options = [
        { label: 'True', isCorrect: answer === 'true', sortOrder: 0 },
        { label: 'False', isCorrect: answer === 'false', sortOrder: 1 },
      ];
    } else if (isObjective) {
      options = labels
        .map((label, i) => ({ label, isCorrect: correct.has(String(i)), sortOrder: i }))
        .filter((o) => o.label.length > 0);

      if (options.length < 2) return { error: 'A multiple choice question needs at least two options.' };

      const correctCount = options.filter((o) => o.isCorrect).length;
      if (correctCount === 0) return { error: 'Mark which option is correct.' };
      if (d.type === 'MCQ_SINGLE' && correctCount > 1) {
        return { error: 'This is a single answer question. Tick exactly one option.' };
      }
    }

    const created = await db.question.create({
      data: {
        bankId: d.bankId,
        type: d.type,
        promptHtml: d.promptHtml,
        explanation: d.explanation || null,
        difficulty: d.difficulty,
        marks: d.marks,
        negativeMarks: takesNegative ? d.negativeMarks : 0,
        answerKey: (answerKey ?? undefined) as never,
        mediaAssetId,
        tags: d.tags ? d.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        options: options.length ? { create: options } : undefined,
      },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'question.created',
      entity: 'Question',
      entityId: created.id,
      after: { type: d.type, bankId: d.bankId },
    });

    revalidatePath(`/admin/question-bank/${d.bankId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export interface BankQuestionHit {
  id: string;
  type: string;
  promptHtml: string;
  marks: number;
  difficulty: string;
  tags: string[];
}

/**
 * Questions for the picker, a page at a time. A bank of three thousand is
 * not sent to the browser; the picker asks for what it needs.
 */
export async function searchBankQuestions(input: {
  bankId: string;
  q?: string;
  tag?: string;
  excludeAssessmentId?: string;
}): Promise<{ rows: BankQuestionHit[]; total: number; error?: string }> {
  try {
    const { tenant } = await guard('courses.assessments', 'view');
    const where = {
      bankId: input.bankId,
      bank: { organizationId: tenant.organizationId },
      ...(input.q?.trim() ? { promptHtml: { contains: input.q.trim(), mode: 'insensitive' as const } } : {}),
      ...(input.tag?.trim() ? { tags: { has: input.tag.trim().toLowerCase() } } : {}),
      ...(input.excludeAssessmentId
        ? { items: { none: { assessmentId: input.excludeAssessmentId } } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.question.findMany({
        where,
        orderBy: { id: 'desc' },
        take: 100,
        select: { id: true, type: true, promptHtml: true, marks: true, difficulty: true, tags: true },
      }),
      db.question.count({ where }),
    ]);
    return { rows, total };
  } catch (err) {
    return { rows: [], total: 0, error: fail(err).error };
  }
}

/**
 * A question used by an assessment that has already been attempted is not
 * deleted. Removing it would rewrite scores that were already earned and
 * reported, which is not a thing a system should be able to do quietly.
 */
export async function deleteQuestion(questionId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('question_bank.manage_questions', 'delete');

    const q = await db.question.findFirst({
      where: { id: questionId, bank: { organizationId: tenant.organizationId } },
      select: { id: true, bankId: true, _count: { select: { answers: true } } },
    });
    if (!q) return { error: 'Question not found.' };
    if (q._count.answers > 0) {
      return {
        error: `${q._count.answers} learner${q._count.answers === 1 ? ' has' : 's have'} already answered this. It stays, so their scores keep meaning what they meant.`,
      };
    }

    await db.question.delete({ where: { id: questionId } });
    revalidatePath(`/admin/question-bank/${q.bankId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Assessments ------------------------------------------------------------- */

const assessment = z.object({
  title: z.string().trim().min(2, 'Give the assessment a title').max(160),
  kind: z.enum(['TEST', 'ASSIGNMENT', 'MOCK_EXAM', 'PRACTICE']),
  instructions: z.string().trim().max(4000).optional().or(z.literal('')),
  durationMinutes: z.coerce.number().min(0).max(600).optional(),
  maxAttempts: z.coerce.number().min(1).max(20),
  passPercent: z.coerce.number().min(0).max(100),
  shuffleQuestions: z.boolean(),
  showResultsImmediately: z.boolean(),
  category: z.string().trim().max(60).optional().or(z.literal('')),
  skill: z.string().trim().max(60).optional().or(z.literal('')),
  level: z.string().trim().max(60).optional().or(z.literal('')),
});

export async function createAssessment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { id?: string }> {
  try {
    const { tenant, user } = await guard('courses.assessments');

    const parsed = assessment.safeParse({
      title: formData.get('title'),
      kind: formData.get('kind') || 'TEST',
      instructions: formData.get('instructions') || '',
      durationMinutes: formData.get('durationMinutes') || 0,
      maxAttempts: formData.get('maxAttempts') || 1,
      passPercent: formData.get('passPercent') || 40,
      shuffleQuestions: formData.get('shuffleQuestions') === 'on',
      showResultsImmediately: formData.get('showResultsImmediately') === 'on',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const created = await db.assessment.create({
      data: {
        organizationId: tenant.organizationId,
        title: d.title,
        kind: d.kind,
        instructions: d.instructions || null,
        durationMinutes: d.durationMinutes ? d.durationMinutes : null,
        maxAttempts: d.maxAttempts,
        passPercent: d.passPercent,
        shuffleQuestions: d.shuffleQuestions,
        showResultsImmediately: d.showResultsImmediately,
      },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'assessment.created',
      entity: 'Assessment',
      entityId: created.id,
      after: { title: d.title, kind: d.kind },
    });

    revalidatePath('/admin/assessments');
    return { ok: true, id: created.id };
  } catch (err) {
    return fail(err);
  }
}

export async function updateAssessment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant } = await guard('courses.assessments');

    const id = String(formData.get('id') ?? '');
    const owned = await db.assessment.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, _count: { select: { attempts: true } } },
    });
    if (!owned) return { error: 'Assessment not found.' };

    const parsed = assessment.safeParse({
      title: formData.get('title'),
      kind: formData.get('kind') || 'TEST',
      instructions: formData.get('instructions') || '',
      durationMinutes: formData.get('durationMinutes') || 0,
      maxAttempts: formData.get('maxAttempts') || 1,
      passPercent: formData.get('passPercent') || 40,
      shuffleQuestions: formData.get('shuffleQuestions') === 'on',
      showResultsImmediately: formData.get('showResultsImmediately') === 'on',
      category: formData.get('category') || '',
      skill: formData.get('skill') || '',
      level: formData.get('level') || '',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    await db.assessment.update({
      where: { id },
      data: {
        title: d.title,
        kind: d.kind,
        instructions: d.instructions || null,
        durationMinutes: d.durationMinutes ? d.durationMinutes : null,
        maxAttempts: d.maxAttempts,
        passPercent: d.passPercent,
        shuffleQuestions: d.shuffleQuestions,
        showResultsImmediately: d.showResultsImmediately,
        category: d.category || null,
        skill: d.skill || null,
        level: d.level || null,
      },
    });

    revalidatePath(`/admin/assessments/${id}`);
    return {
      ok: true,
      message: owned._count.attempts
        ? 'Saved. Attempts already taken keep the marks they were scored on.'
        : 'Saved.',
    };
  } catch (err) {
    return fail(err);
  }
}

export async function addQuestionsToAssessment(
  assessmentId: string,
  questionIds: string[],
): Promise<ActionState> {
  try {
    const { tenant } = await guard('courses.assessments');

    const owned = await db.assessment.findFirst({
      where: { id: assessmentId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!owned) return { error: 'Assessment not found.' };

    const valid = await db.question.findMany({
      where: { id: { in: questionIds }, bank: { organizationId: tenant.organizationId } },
      select: { id: true },
    });

    const existing = await db.assessmentQuestion.count({ where: { assessmentId } });

    await db.assessmentQuestion.createMany({
      data: valid.map((q, i) => ({
        assessmentId,
        questionId: q.id,
        sortOrder: existing + i,
      })),
      skipDuplicates: true,
    });

    revalidatePath(`/admin/assessments/${assessmentId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function removeQuestionFromAssessment(
  assessmentId: string,
  questionId: string,
): Promise<ActionState> {
  try {
    const { tenant } = await guard('courses.assessments');

    const owned = await db.assessment.findFirst({
      where: { id: assessmentId, organizationId: tenant.organizationId },
      select: { _count: { select: { attempts: true } } },
    });
    if (!owned) return { error: 'Assessment not found.' };
    if (owned._count.attempts > 0) {
      return {
        error: 'Learners have already sat this. Removing a question would rewrite their scores.',
      };
    }

    await db.assessmentQuestion.deleteMany({ where: { assessmentId, questionId } });
    revalidatePath(`/admin/assessments/${assessmentId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setAssessmentCourses(
  assessmentId: string,
  courseIds: string[],
): Promise<ActionState> {
  try {
    const { tenant } = await guard('courses.assessments');

    const owned = await db.assessment.findFirst({
      where: { id: assessmentId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!owned) return { error: 'Assessment not found.' };

    const valid = await db.course.findMany({
      where: { id: { in: courseIds }, organizationId: tenant.organizationId },
      select: { id: true },
    });

    await db.$transaction([
      db.assessmentCourse.deleteMany({ where: { assessmentId } }),
      db.assessmentCourse.createMany({
        data: valid.map((c) => ({ assessmentId, courseId: c.id })),
        skipDuplicates: true,
      }),
    ]);

    revalidatePath(`/admin/assessments/${assessmentId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Sections ---------------------------------------------------------------- */

async function ownedAssessment(assessmentId: string, organizationId: string) {
  return db.assessment.findFirst({
    where: { id: assessmentId, organizationId },
    select: { id: true, _count: { select: { attempts: true, sections: true } } },
  });
}

const sectionShape = z.object({
  assessmentId: z.string().min(1),
  id: z.string().max(60).optional(),
  title: z.string().trim().min(1, 'Give the section a name.').max(120),
  instructions: z.string().trim().max(4000).optional().or(z.literal('')),
  durationMinutes: z.coerce.number().int().min(0).max(600),
});

/** Create or rename a section, with or without a clock of its own. */
export async function saveSection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant } = await guard('courses.assessments');
    const parsed = sectionShape.safeParse({
      assessmentId: formData.get('assessmentId'),
      id: formData.get('id') || undefined,
      title: formData.get('title'),
      instructions: formData.get('instructions') || '',
      durationMinutes: formData.get('durationMinutes') || 0,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const owned = await ownedAssessment(d.assessmentId, tenant.organizationId);
    if (!owned) return { error: 'Assessment not found.' };
    if (owned._count.attempts > 0 && !d.id) return { error: 'Learners have already sat this, so its sections are fixed.' };

    const data = { title: d.title, instructions: d.instructions || null, durationMinutes: d.durationMinutes > 0 ? d.durationMinutes : null };
    if (d.id) {
      const section = await db.assessmentSection.findFirst({ where: { id: d.id, assessmentId: d.assessmentId }, select: { id: true } });
      if (!section) return { error: 'Section not found.' };
      await db.assessmentSection.update({ where: { id: d.id }, data });
    } else {
      await db.assessmentSection.create({ data: { assessmentId: d.assessmentId, sortOrder: owned._count.sections, ...data } });
    }
    revalidatePath(`/admin/assessments/${d.assessmentId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteSection(assessmentId: string, sectionId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('courses.assessments');
    const owned = await ownedAssessment(assessmentId, tenant.organizationId);
    if (!owned) return { error: 'Assessment not found.' };
    if (owned._count.attempts > 0) return { error: 'Learners have already sat this, so its sections are fixed.' };
    // Questions in it fall back to the paper's own time; nothing is lost.
    await db.assessmentSection.deleteMany({ where: { id: sectionId, assessmentId } });
    revalidatePath(`/admin/assessments/${assessmentId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Put a question in a section, or take it out (sectionId null). */
export async function setQuestionSection(assessmentId: string, questionId: string, sectionId: string | null): Promise<ActionState> {
  try {
    const { tenant } = await guard('courses.assessments');
    const owned = await ownedAssessment(assessmentId, tenant.organizationId);
    if (!owned) return { error: 'Assessment not found.' };
    if (owned._count.attempts > 0) return { error: 'Learners have already sat this, so the paper is fixed.' };
    if (sectionId) {
      const section = await db.assessmentSection.findFirst({ where: { id: sectionId, assessmentId }, select: { id: true } });
      if (!section) return { error: 'Section not found.' };
    }
    await db.assessmentQuestion.update({
      where: { assessmentId_questionId: { assessmentId, questionId } },
      data: { sectionId },
    });
    revalidatePath(`/admin/assessments/${assessmentId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
