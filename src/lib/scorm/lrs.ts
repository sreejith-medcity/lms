import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { XAPI_DONE_VERBS, XAPI_FAILED_VERB } from './data-model';
import { randomUUID } from 'node:crypto';

/**
 * The little LRS. Statements are kept whole; the verb and the object are
 * lifted out so a completion can move the lesson's progress without
 * reading JSON in a report. The State API keeps the package's bookmarks.
 */

interface Statement {
  id?: string;
  verb?: { id?: string };
  object?: { id?: string };
  result?: { score?: { raw?: number; max?: number; min?: number; scaled?: number }; success?: boolean; completion?: boolean; duration?: string };
}

export async function storeStatements(input: { organizationId: string; packageId: string; userId: string; statements: unknown }): Promise<{ ids: string[]; done: boolean; failed: boolean; scoreRaw: number | null; scoreMax: number | null }> {
  const list = (Array.isArray(input.statements) ? input.statements : [input.statements]) as Statement[];
  const ids: string[] = [];
  let done = false;
  let failed = false;
  let scoreRaw: number | null = null;
  let scoreMax: number | null = null;
  for (const st of list) {
    if (!st || typeof st !== 'object') continue;
    const id = typeof st.id === 'string' && st.id ? st.id : randomUUID();
    const verb = st.verb?.id ?? '';
    const objectId = st.object?.id ?? '';
    await db.xapiStatement.upsert({
      where: { statementId: id },
      create: { organizationId: input.organizationId, packageId: input.packageId, userId: input.userId, statementId: id, verb, objectId, statement: { ...st, id } as unknown as Prisma.InputJsonValue },
      update: {},
    });
    ids.push(id);
    if (XAPI_DONE_VERBS.has(verb) || st.result?.completion === true || st.result?.success === true) done = true;
    if (verb === XAPI_FAILED_VERB || st.result?.success === false) failed = true;
    const score = st.result?.score;
    if (score) {
      if (typeof score.raw === 'number') {
        scoreRaw = score.raw;
        scoreMax = typeof score.max === 'number' ? score.max : scoreMax;
      } else if (typeof score.scaled === 'number') {
        scoreRaw = Math.round(score.scaled * 100);
        scoreMax = 100;
      }
    }
  }
  return { ids, done, failed, scoreRaw, scoreMax };
}

/** Fold a batch of statements into the attempt row and say whether the lesson is now done. */
export async function applyToAttempt(packageId: string, userId: string, r: { done: boolean; failed: boolean; scoreRaw: number | null; scoreMax: number | null }): Promise<boolean> {
  const existing = await db.scormAttempt.findUnique({ where: { packageId_userId: { packageId, userId } }, select: { lessonStatus: true } });
  const wasDone = existing?.lessonStatus === 'completed' || existing?.lessonStatus === 'passed';
  const lessonStatus = r.done ? (r.failed ? 'completed' : r.scoreRaw !== null ? 'passed' : 'completed') : r.failed ? 'failed' : existing?.lessonStatus ?? 'incomplete';
  await db.scormAttempt.upsert({
    where: { packageId_userId: { packageId, userId } },
    create: { packageId, userId, lessonStatus, scoreRaw: r.scoreRaw, scoreMax: r.scoreMax },
    update: { lessonStatus: wasDone && !r.done ? existing!.lessonStatus : lessonStatus, ...(r.scoreRaw !== null ? { scoreRaw: r.scoreRaw, scoreMax: r.scoreMax } : {}) },
  });
  return r.done && !wasDone;
}

export async function readState(packageId: string, userId: string, stateId: string): Promise<unknown> {
  const row = await db.scormAttempt.findUnique({ where: { packageId_userId: { packageId, userId } }, select: { xapiState: true } });
  const all = (row?.xapiState ?? {}) as Record<string, unknown>;
  return all[stateId] ?? null;
}

export async function writeState(packageId: string, userId: string, stateId: string, value: unknown | null): Promise<void> {
  const row = await db.scormAttempt.findUnique({ where: { packageId_userId: { packageId, userId } }, select: { xapiState: true } });
  const all = { ...((row?.xapiState ?? {}) as Record<string, unknown>) };
  if (value === null) delete all[stateId];
  else all[stateId] = value;
  await db.scormAttempt.upsert({
    where: { packageId_userId: { packageId, userId } },
    create: { packageId, userId, xapiState: all as Prisma.InputJsonValue },
    update: { xapiState: all as Prisma.InputJsonValue },
  });
}
