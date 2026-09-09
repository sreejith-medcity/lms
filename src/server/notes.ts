'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import type { ActionState } from '@/server/courses';
import { curriculumGate } from '@/lib/curriculum-access';

/**
 * Notes, bookmarks and the resume position.
 *
 * All three are per learner and only ever reachable through an enrolment that is
 * checked here, so one learner cannot read or write another's notes by guessing
 * a material id.
 */

async function entitled(materialId: string) {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) throw new Error('SIGN_IN_REQUIRED');

  const enrollment = await db.enrollment.findFirst({
    where: {
      userId: user.id,
      organizationId: tenant.organizationId,
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      product: {
        course: {
          modules: {
            some: {
              module: { sections: { some: { materials: { some: { id: materialId } } } } },
            },
          },
        },
      },
    },
    select: {
      id: true,
      productId: true,
      batchId: true,
      createdAt: true,
      product: { select: { course: { select: { id: true } } } },
    },
  });
  if (!enrollment) throw new Error('NOT_ENROLLED');

  // Enrolled is not the same as released: a dripped lesson is refused here too,
  // because a lock only the page knows about is a lock anyone can walk past.
  const courseId = enrollment.product.course?.id;
  if (courseId) {
    const material = await db.material.findUnique({
      where: { id: materialId },
      select: { sectionId: true, section: { select: { isVisible: true } } },
    });
    if (!material || !material.section.isVisible) throw new Error('NOT_OPEN_YET');

    const gate = await curriculumGate({
      courseId,
      enrolledAt: enrollment.createdAt,
      batchId: enrollment.batchId,
    });
    if (gate.lockOf(materialId, material.sectionId)) throw new Error('NOT_OPEN_YET');
  }

  return { user, enrollment };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'SIGN_IN_REQUIRED') return { error: 'Please sign in again.' };
  if (message === 'NOT_ENROLLED') return { error: 'This lesson is not part of your enrolment.' };
  if (message === 'NOT_OPEN_YET') return { error: 'This lesson has not opened yet.' };
  console.error('[notes]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function addNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const materialId = String(formData.get('materialId') ?? '');
    const body = String(formData.get('body') ?? '').trim();
    const rawAt = String(formData.get('atSeconds') ?? '');

    if (body.length < 1) return { error: 'Write something first.' };
    if (body.length > 4000) return { error: 'That note is too long.' };

    const { user, enrollment } = await entitled(materialId);

    const atSeconds = rawAt ? Math.max(0, Math.round(Number(rawAt))) : null;

    await db.learnerNote.create({
      data: {
        userId: user.id,
        materialId,
        enrollmentId: enrollment.id,
        atSeconds: Number.isFinite(atSeconds) ? atSeconds : null,
        body,
      },
    });

    revalidatePath(`/learn/${enrollment.productId}/${materialId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateNote(noteId: string, body: string): Promise<ActionState> {
  try {
    const clean = body.trim();
    if (!clean) return { error: 'A note cannot be empty. Delete it instead.' };

    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };

    const updated = await db.learnerNote.updateMany({
      where: { id: noteId, userId: user.id },
      data: { body: clean.slice(0, 4000) },
    });
    if (!updated.count) return { error: 'Note not found.' };

    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteNote(noteId: string): Promise<ActionState> {
  try {
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };

    await db.learnerNote.deleteMany({ where: { id: noteId, userId: user.id } });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function toggleBookmark(materialId: string): Promise<ActionState & { on?: boolean }> {
  try {
    const { user, enrollment } = await entitled(materialId);

    const existing = await db.materialProgress.findUnique({
      where: { userId_materialId: { userId: user.id, materialId } },
      select: { isBookmarked: true },
    });

    const on = !existing?.isBookmarked;

    await db.materialProgress.upsert({
      where: { userId_materialId: { userId: user.id, materialId } },
      create: {
        userId: user.id,
        materialId,
        enrollmentId: enrollment.id,
        isBookmarked: on,
        lastViewedAt: new Date(),
      },
      update: { isBookmarked: on },
    });

    revalidatePath(`/learn/${enrollment.productId}`);
    return { ok: true, on };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Where the player got to. Called on a throttle from the browser and when the
 * page is hidden, so closing a tab mid-lesson does not lose the place.
 *
 * secondsViewed only ever increases; scrubbing backwards moves the resume point
 * without pretending less has been watched.
 */
export async function savePosition(
  materialId: string,
  positionSeconds: number,
  durationSeconds?: number,
): Promise<void> {
  try {
    const { user, enrollment } = await entitled(materialId);

    const position = Math.max(0, Math.round(positionSeconds));
    const percent =
      durationSeconds && durationSeconds > 0
        ? Math.min(100, Math.round((position / durationSeconds) * 100))
        : undefined;

    const existing = await db.materialProgress.findUnique({
      where: { userId_materialId: { userId: user.id, materialId } },
      select: { secondsViewed: true, percent: true },
    });

    await db.materialProgress.upsert({
      where: { userId_materialId: { userId: user.id, materialId } },
      create: {
        userId: user.id,
        materialId,
        enrollmentId: enrollment.id,
        positionSeconds: position,
        secondsViewed: position,
        percent: percent ?? 0,
        lastViewedAt: new Date(),
      },
      update: {
        positionSeconds: position,
        secondsViewed: Math.max(existing?.secondsViewed ?? 0, position),
        percent: percent != null ? Math.max(existing?.percent ?? 0, percent) : undefined,
        lastViewedAt: new Date(),
      },
    });

    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { lastActivityAt: new Date() },
    });
  } catch (err) {
    // Losing a position ping is not worth interrupting a lesson over.
    console.error('[notes] position', err instanceof Error ? err.message : err);
  }
}
