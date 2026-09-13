'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser, requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { askClaude, anthropicReady } from '@/lib/anthropic';
import { segmentsOf } from '@/lib/transcripts';
import { transcriptForPrompt } from '@/lib/tutor';
import { FRESH, cardProblem, flashcardPrompt, parseFlashcards, schedule, type Grade } from '@/lib/revision';
import type { ActionState } from '@/server/courses';

/**
 * Flashcards: set by the trainer for a course (or drafted from a lesson's
 * transcript), or written by a learner for themselves; graded by the
 * learner in a revision session, which schedules the next look.
 */

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED' || message === 'SIGN_IN_REQUIRED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  if (message === 'ANTHROPIC_NOT_CONNECTED') return { error: 'Add the Anthropic key under Integrations first.' };
  if (message.startsWith('ANTHROPIC_')) return { error: 'The model could not be reached just now. Try again in a moment.' };
  console.error('[flashcards]', message);
  return { error: 'Something went wrong. Please try again.' };
}

async function staff() {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('courses.course_management', 'edit')]);
  return { tenant, user };
}

/** A learner's live enrolment in the course, or nothing. */
async function learnerOn(organizationId: string, userId: string, courseId: string) {
  return db.enrollment.findFirst({
    where: { organizationId, userId, status: { notIn: ['CANCELLED', 'ARCHIVED', 'EXPIRED'] }, product: { course: { id: courseId } } },
    select: { id: true, productId: true },
  });
}

/* Trainer -------------------------------------------------------------------- */

export async function saveCard(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await staff();
    const id = String(formData.get('id') ?? '');
    const courseId = String(formData.get('courseId') ?? '');
    const front = String(formData.get('front') ?? '').trim();
    const back = String(formData.get('back') ?? '').trim();
    const hint = String(formData.get('hint') ?? '').trim() || null;
    const problem = cardProblem(front, back);
    if (problem) return { error: problem };

    const course = await db.course.findFirst({ where: { id: courseId, organizationId: tenant.organizationId }, select: { id: true, productId: true } });
    if (!course) return { error: 'Course not found.' };

    if (id) {
      const changed = await db.flashcard.updateMany({
        where: { id, organizationId: tenant.organizationId, courseId: course.id, ownerUserId: null },
        data: { front, back, hint },
      });
      if (changed.count === 0) return { error: 'Card not found.' };
    } else {
      const last = await db.flashcard.aggregate({ where: { organizationId: tenant.organizationId, courseId: course.id, ownerUserId: null }, _max: { sortOrder: true } });
      await db.flashcard.create({
        data: { organizationId: tenant.organizationId, courseId: course.id, front, back, hint, source: 'TRAINER', createdById: user.id, sortOrder: (last._max.sortOrder ?? 0) + 1 },
      });
    }
    revalidatePath(`/admin/courses/${course.productId}/flashcards`);
    revalidatePath(`/learn/${course.productId}/revise`);
    return { ok: true, message: id ? 'Saved.' : 'Card added.' };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteCard(id: string): Promise<ActionState> {
  try {
    const { tenant } = await staff();
    const card = await db.flashcard.findFirst({ where: { id, organizationId: tenant.organizationId, ownerUserId: null }, select: { id: true, course: { select: { productId: true } } } });
    if (!card) return { error: 'Card not found.' };
    await db.flashcard.delete({ where: { id: card.id } });
    revalidatePath(`/admin/courses/${card.course.productId}/flashcards`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Cards drafted by the model from a lesson's transcript, kept as the course's cards. */
export async function draftCardsFromLesson(materialId: string, count: number): Promise<ActionState> {
  try {
    const { tenant, user } = await staff();
    if (!(await anthropicReady(tenant.organizationId))) throw new Error('ANTHROPIC_NOT_CONNECTED');
    const material = await db.material.findFirst({
      where: { id: materialId, asset: { organizationId: tenant.organizationId } },
      select: {
        id: true,
        title: true,
        asset: { select: { transcript: { select: { segments: true } } } },
        section: { select: { module: { select: { courses: { select: { course: { select: { id: true, productId: true } } }, take: 1 } } } } },
      },
    });
    const course = material?.section.module.courses[0]?.course;
    if (!material || !course) return { error: 'Lesson not found.' };
    const segments = segmentsOf(material.asset?.transcript?.segments);
    if (segments.length === 0) return { error: 'This lesson needs a transcript first.' };

    const prompt = flashcardPrompt({ lessonTitle: material.title, text: transcriptForPrompt(segments, 30_000), count: Math.max(1, Math.min(40, count)) });
    const reply = await askClaude({ organizationId: tenant.organizationId, system: prompt.system, user: prompt.user, maxTokens: 3000, purpose: 'Drafted flashcards from a lesson' });
    const cards = parseFlashcards(reply.text);
    if (cards.length === 0) return { error: 'The model wrote nothing usable. Try again.' };

    const existing = new Set((await db.flashcard.findMany({ where: { organizationId: tenant.organizationId, courseId: course.id, ownerUserId: null }, select: { front: true } })).map((c) => c.front.toLowerCase()));
    const fresh = cards.filter((c) => !existing.has(c.front.toLowerCase()));
    const last = await db.flashcard.aggregate({ where: { organizationId: tenant.organizationId, courseId: course.id, ownerUserId: null }, _max: { sortOrder: true } });
    let order = last._max.sortOrder ?? 0;
    await db.flashcard.createMany({
      data: fresh.map((c) => ({
        organizationId: tenant.organizationId,
        courseId: course.id,
        materialId: material.id,
        front: c.front,
        back: c.back,
        hint: c.hint,
        source: 'AI',
        createdById: user.id,
        sortOrder: (order += 1),
      })),
    });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'flashcards.drafted', entity: 'Course', entityId: course.id, after: { from: material.id, added: fresh.length } });
    revalidatePath(`/admin/courses/${course.productId}/flashcards`);
    return { ok: true, message: `${fresh.length} cards added from ${material.title}${fresh.length < cards.length ? ` (${cards.length - fresh.length} already there)` : ''}. Read them; the source column says which came from the model.` };
  } catch (err) {
    return fail(err);
  }
}

/* Learner -------------------------------------------------------------------- */

export async function addMyCard(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) throw new Error('SIGN_IN_REQUIRED');
    const courseId = String(formData.get('courseId') ?? '');
    const front = String(formData.get('front') ?? '').trim();
    const back = String(formData.get('back') ?? '').trim();
    const problem = cardProblem(front, back);
    if (problem) return { error: problem };
    const enrolment = await learnerOn(tenant.organizationId, user.id, courseId);
    if (!enrolment) return { error: 'You are not on that course.' };
    const mine = await db.flashcard.count({ where: { organizationId: tenant.organizationId, courseId, ownerUserId: user.id } });
    if (mine >= 500) return { error: 'Five hundred cards of your own is the limit on one course.' };
    await db.flashcard.create({
      data: { organizationId: tenant.organizationId, courseId, front, back, source: 'LEARNER', ownerUserId: user.id, createdById: user.id, sortOrder: mine + 1 },
    });
    revalidatePath(`/learn/${enrolment.productId}/revise`);
    return { ok: true, message: 'Card added. It comes up in your next session.' };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteMyCard(id: string): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) throw new Error('SIGN_IN_REQUIRED');
    const gone = await db.flashcard.deleteMany({ where: { id, organizationId: tenant.organizationId, ownerUserId: user.id } });
    if (gone.count === 0) return { error: 'Only your own cards can be removed.' };
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** The learner answers a card: again, hard, good or easy. */
export async function gradeCard(cardId: string, grade: number): Promise<ActionState & { dueLabel?: string }> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) throw new Error('SIGN_IN_REQUIRED');
    const g = Math.max(0, Math.min(3, Math.round(grade))) as Grade;

    const card = await db.flashcard.findFirst({
      where: { id: cardId, organizationId: tenant.organizationId, OR: [{ ownerUserId: null }, { ownerUserId: user.id }] },
      select: { id: true, courseId: true },
    });
    if (!card) return { error: 'Card not found.' };
    if (!(await learnerOn(tenant.organizationId, user.id, card.courseId))) return { error: 'You are not on that course.' };

    const current = await db.flashcardReview.findUnique({ where: { cardId_userId: { cardId: card.id, userId: user.id } } });
    const next = schedule(current ?? FRESH, g);
    await db.flashcardReview.upsert({
      where: { cardId_userId: { cardId: card.id, userId: user.id } },
      create: { cardId: card.id, userId: user.id, due: next.due, intervalDays: next.intervalDays, ease: next.ease, reps: next.reps, lapses: next.lapses, lastGrade: g, lastReviewedAt: new Date() },
      update: { due: next.due, intervalDays: next.intervalDays, ease: next.ease, reps: next.reps, lapses: next.lapses, lastGrade: g, lastReviewedAt: new Date() },
    });
    return { ok: true, dueLabel: g === 0 ? 'again in a few minutes' : next.intervalDays === 1 ? 'tomorrow' : `in ${next.intervalDays} days` };
  } catch (err) {
    return fail(err);
  }
}
