'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import {
  ExamError,
  beginSection,
  claimPlay,
  finishPreparation,
  finishSection,
  handIn,
  recordGuard,
  saveAnswer,
  saveChoice,
  saveNotes,
  saveWriting,
  startSitting,
} from '@/lib/exams/sittings';
import type { SectionClock } from '@/lib/exams/clock';

/**
 * What the exam player calls. Every action checks the academy and the
 * person, and the sitting logic checks the clock; the page never decides
 * whether time is up.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function who() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) throw new ExamError('Please sign in again.');
  return { organizationId: tenant.organizationId, user };
}

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof ExamError) return { ok: false, error: err.message };
  console.error('[tests]', err);
  return { ok: false, error: 'That did not save. Check the connection and try again.' };
}

export async function startTest(formatCode: string, mode: 'exam' | 'practice', assignmentId?: string | null): Promise<Result> {
  let id: string;
  try {
    const { organizationId, user } = await who();
    const started = await startSitting({
      organizationId,
      userId: user.id,
      formatCode,
      mode: mode === 'practice' ? 'practice' : 'exam',
      assignmentId: assignmentId ?? null,
      staff: user.kind === 'STAFF',
    });
    id = started.id;
  } catch (err) {
    return fail(err);
  }
  redirect(`/exam/${id}`);
}

export async function startSectionAction(sittingId: string, sectionId: string): Promise<Result<{ clock: SectionClock | null }>> {
  try {
    const { organizationId, user } = await who();
    const clock = await beginSection(organizationId, user.id, sittingId, sectionId);
    return { ok: true, clock };
  } catch (err) {
    return fail(err);
  }
}

export async function endPreparationAction(sittingId: string, sectionId: string): Promise<Result<{ clock: SectionClock | null }>> {
  try {
    const { organizationId, user } = await who();
    const clock = await finishPreparation(organizationId, user.id, sittingId, sectionId);
    return { ok: true, clock };
  } catch (err) {
    return fail(err);
  }
}

export async function saveAnswerAction(sittingId: string, n: number, value: string | null): Promise<Result> {
  try {
    const { organizationId, user } = await who();
    await saveAnswer(organizationId, user.id, sittingId, n, value);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveChoiceAction(sittingId: string, blockId: string, index: number): Promise<Result> {
  try {
    const { organizationId, user } = await who();
    await saveChoice(organizationId, user.id, sittingId, blockId, index);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveWritingAction(sittingId: string, blockId: string, text: string): Promise<Result> {
  try {
    const { organizationId, user } = await who();
    await saveWriting(organizationId, user.id, sittingId, blockId, text);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveNotesAction(sittingId: string, sectionId: string, notes: string): Promise<Result> {
  try {
    const { organizationId, user } = await who();
    await saveNotes(organizationId, user.id, sittingId, sectionId, notes);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function claimPlayAction(sittingId: string, blockId: string): Promise<Result<{ allowed: boolean }>> {
  try {
    const { organizationId, user } = await who();
    const r = await claimPlay(organizationId, user.id, sittingId, blockId);
    return { ok: true, allowed: r.ok };
  } catch (err) {
    return fail(err);
  }
}

export async function guardAction(sittingId: string, kind: 'leave' | 'copy' | 'translate'): Promise<Result> {
  try {
    const { organizationId, user } = await who();
    await recordGuard(organizationId, user.id, sittingId, kind);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function finishSectionAction(sittingId: string, sectionId: string): Promise<Result<{ allDone: boolean }>> {
  try {
    const { organizationId, user } = await who();
    const r = await finishSection(organizationId, user.id, sittingId, sectionId);
    return { ok: true, allDone: r.allDone };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Hand the paper in. The objective part is counted at once; the writing
 * and speaking go to the marker after the answer has gone back, so the
 * candidate is not kept waiting on a model: the result page shows them
 * arriving.
 */
export async function handInAction(sittingId: string): Promise<Result> {
  try {
    const { organizationId, user } = await who();
    const mark = await handIn(organizationId, user.id, sittingId);
    after(mark);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
