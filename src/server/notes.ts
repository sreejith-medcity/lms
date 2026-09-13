'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import type { ActionState } from '@/server/courses';
import { requireTenant } from '@/lib/tenant';
import { entitledToLesson, lessonFail } from '@/lib/lesson-entitlement';
import { settingBool, settingNumber } from '@/lib/settings/store';

/**
 * Notes, bookmarks and the resume position.
 *
 * All three are per learner and only ever reachable through an enrolment that is
 * checked in `entitledToLesson`, so one learner cannot read or write another's
 * notes by guessing a material id.
 */

const entitled = entitledToLesson;
const fail = (err: unknown) => lessonFail('notes', err);

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
      select: { secondsViewed: true, percent: true, completedAt: true },
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

    // Past the academy's threshold, the lesson is theirs. Doing it here rather
    // than in the browser means it survives a closed tab, and a learner who
    // watched ninety percent of a lesson is not asked to also press a button.
    const tenant = await requireTenant();
    const [threshold, auto] = await Promise.all([
      settingNumber(tenant.organizationId, 'learning.videoCompletePercent'),
      settingBool(tenant.organizationId, 'learning.autoComplete'),
    ]);

    if (auto && percent != null && percent >= threshold && !existing?.completedAt) {
      const { setMaterialComplete } = await import('@/server/enrollment');
      await setMaterialComplete(enrollment.productId, materialId, true);
    }
  } catch (err) {
    // Losing a position ping is not worth interrupting a lesson over.
    console.error('[notes] position', err instanceof Error ? err.message : err);
  }
}
