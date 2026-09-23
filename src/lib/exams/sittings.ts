import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { examFormat } from '@/lib/exams/registry';
import type { ExamBlockDef, ExamFormat } from '@/lib/exams/types';
import { isAuto } from '@/lib/exams/types';
import { drawPaper, newDrawCode, normaliseDrawCode, type PaperBlock } from '@/lib/exams/draw';
import { activeSets } from '@/lib/exams/content';
import { syncCourseAllowances } from '@/lib/exams/course-allowances';
import { pickAllowance, type AllowanceRow } from '@/lib/exams/allowance';
import { markPaper, modulePoints, resultOf, type Answers } from '@/lib/exams/score';
import {
  allDone,
  endPreparation,
  latestEnd,
  mayAnswer,
  mayTakeNotes,
  sectionStatus,
  startClock,
  type Clocks,
  type SittingClockState,
} from '@/lib/exams/clock';
import { criteriaFor, parseMarking, markingSchema, speakingPrompt, taskTextOf, writingPrompt } from '@/lib/exams/marking';
import { askGemini, geminiReady } from '@/lib/exams/gemini';
import { buildObjectKey, getObject, putObject } from '@/lib/storage';

/**
 * A sitting from start to result. Every rule that decides something (the
 * clocks, what counts, the pass) lives in the pure modules beside this;
 * this file reads and writes the rows and calls the marker.
 */

export class ExamError extends Error {}

type SittingRow = NonNullable<Awaited<ReturnType<typeof loadSittingRow>>>;

export async function loadSittingRow(organizationId: string, id: string) {
  return db.examSitting.findFirst({ where: { id, organizationId } });
}

export function clockStateOf(s: { mode: string; sectionId: string | null; sectionClock: unknown; sectionsDone: unknown }): SittingClockState {
  return {
    mode: s.mode === 'practice' ? 'practice' : 'exam',
    onlySection: s.sectionId,
    clocks: (s.sectionClock ?? {}) as Clocks,
    done: Array.isArray(s.sectionsDone) ? (s.sectionsDone as string[]) : [],
  };
}

export function formatOf(code: string): ExamFormat {
  const f = examFormat(code);
  if (!f) throw new ExamError('This test is not offered.');
  return f;
}

export function paperOf(s: { paper: unknown }): PaperBlock[] {
  return Array.isArray(s.paper) ? (s.paper as PaperBlock[]) : [];
}

/** The block an item number belongs to. */
function blockOfItem(paper: PaperBlock[], n: number): PaperBlock | undefined {
  return paper.find((p) => (p.items ?? []).some((it) => it.n === n));
}

/* ---------------------------------------------------------------- start */

export interface StartInput {
  organizationId: string;
  userId: string;
  formatCode: string;
  mode: 'exam' | 'practice';
  /** A tutor's set paper: its code and part, and no allowance is spent. */
  assignmentId?: string | null;
  /** Staff trying a paper: no allowance, never counted. */
  staff?: boolean;
  now?: Date;
}

/**
 * Start a paper, or hand back the one already under way for this format.
 * Spends one paper of the allowance at the start rather than the end, so
 * that opening a paper to look at it and walking away is not a free look
 * at the next one.
 */
export async function startSitting(input: StartInput): Promise<{ id: string; resumed: boolean }> {
  const now = input.now ?? new Date();
  const format = formatOf(input.formatCode);

  const open = await db.examSitting.findFirst({
    where: { organizationId: input.organizationId, userId: input.userId, formatCode: format.code, status: 'IN_PROGRESS', assignmentId: input.assignmentId ?? null },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true, sectionId: true },
  });
  if (open && latestEnd(format, open.startedAt, open.sectionId) > now) return { id: open.id, resumed: true };

  const sets = await activeSets(input.organizationId, format.code);
  if (!sets.length) throw new ExamError('This test has no papers yet.');

  let drawCode = newDrawCode();
  let sectionId: string | null = null;
  if (input.assignmentId) {
    const a = await db.examAssignment.findFirst({ where: { id: input.assignmentId, organizationId: input.organizationId, active: true, formatCode: format.code } });
    if (!a) throw new ExamError('That paper is no longer set.');
    /* A set paper is free, so only the batch it was set for may sit it. */
    if (!input.staff) {
      const inBatch = a.batchId
        ? await db.enrollment.count({
            where: { organizationId: input.organizationId, userId: input.userId, batchId: a.batchId, status: { in: ['ENROLLED', 'REGISTERED', 'COMPLETED'] } },
          })
        : 0;
      if (!inBatch) throw new ExamError('That paper was set for another batch.');
    }
    drawCode = normaliseDrawCode(a.drawCode);
    sectionId = a.sectionId;
  }

  let allowanceId: string | null = null;
  if (!input.staff && !input.assignmentId) {
    await syncCourseAllowances(input.organizationId, input.userId);
    const rows = (await db.examAllowance.findMany({
      where: { organizationId: input.organizationId, userId: input.userId, familyCode: format.family, revokedAt: null },
    })) as AllowanceRow[];
    const pick = pickAllowance(rows, format.family, format.level, now);
    if (!pick) throw new ExamError('You have no papers left for this test.');
    allowanceId = pick.id;
  }

  const paper = drawPaper(format, sets, drawCode);
  const created = await db.$transaction(async (tx) => {
    if (allowanceId) {
      /* Spent only if still there to spend: two tabs starting at once cannot both have the last one. */
      const spent = await tx.$executeRaw`
        UPDATE "exam_allowances" SET "used" = "used" + 1
        WHERE "id" = ${allowanceId} AND "revokedAt" IS NULL AND ("tests" IS NULL OR "used" < "tests")`;
      if (spent !== 1) throw new ExamError('You have no papers left for this test.');
    }
    return tx.examSitting.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        formatCode: format.code,
        drawCode,
        mode: input.mode,
        sectionId,
        assignmentId: input.assignmentId ?? null,
        allowanceId,
        paper: paper as unknown as Prisma.InputJsonValue,
        sectionClock: {},
        sectionsDone: [],
        answers: {},
        plays: {},
        notes: {},
        guard: {},
        maxPoints: format.scoring.total,
      },
      select: { id: true },
    });
  });
  return { id: created.id, resumed: false };
}

/* ------------------------------------------------------------- the clock */

async function ownSitting(organizationId: string, userId: string, id: string): Promise<SittingRow> {
  const s = await loadSittingRow(organizationId, id);
  if (!s || s.userId !== userId) throw new ExamError('That paper is not yours.');
  if (s.status !== 'IN_PROGRESS') throw new ExamError('This paper has been handed in.');
  return s;
}

export async function beginSection(organizationId: string, userId: string, id: string, sectionId: string, now = new Date()) {
  const s = await ownSitting(organizationId, userId, id);
  const format = formatOf(s.formatCode);
  const state = clockStateOf(s);
  if (state.mode === 'practice') return null;
  const status = sectionStatus(format, state, sectionId, now);
  if (status !== 'waiting') {
    if (status === 'open' || status === 'prep') return state.clocks[sectionId] ?? null;
    throw new ExamError(status === 'closed' ? 'That part is finished.' : 'Finish the part before this first.');
  }
  const clock = startClock(format, sectionId, now);
  const clocks = { ...state.clocks, [sectionId]: clock };
  await db.examSitting.update({ where: { id }, data: { sectionClock: clocks as unknown as Prisma.InputJsonValue } });
  return clock;
}

export async function finishPreparation(organizationId: string, userId: string, id: string, sectionId: string, now = new Date()) {
  const s = await ownSitting(organizationId, userId, id);
  const format = formatOf(s.formatCode);
  const state = clockStateOf(s);
  const c = state.clocks[sectionId];
  if (!c || c.phase !== 'prep') return c ?? null;
  const clock = endPreparation(format, c, sectionId, now);
  const clocks = { ...state.clocks, [sectionId]: clock };
  await db.examSitting.update({ where: { id }, data: { sectionClock: clocks as unknown as Prisma.InputJsonValue } });
  return clock;
}

export async function finishSection(organizationId: string, userId: string, id: string, sectionId: string, now = new Date()) {
  const s = await ownSitting(organizationId, userId, id);
  const format = formatOf(s.formatCode);
  const state = clockStateOf(s);
  if (!state.done.includes(sectionId)) state.done.push(sectionId);
  await db.examSitting.update({ where: { id }, data: { sectionsDone: state.done as unknown as Prisma.InputJsonValue } });
  return { allDone: allDone(format, state, now) };
}

/* ------------------------------------------------------------ answering */

const ANSWER_MAX = 300;

export async function saveAnswer(organizationId: string, userId: string, id: string, n: number, value: string | null, now = new Date()) {
  const s = await ownSitting(organizationId, userId, id);
  const format = formatOf(s.formatCode);
  const block = blockOfItem(paperOf(s), n);
  if (!block) throw new ExamError('No such question.');
  if (!mayAnswer(format, clockStateOf(s), block.sectionId, now)) throw new ExamError('Time is up for this part.');
  /* One statement, so two quick clicks cannot overwrite each other's answers. */
  const clean = value === null ? null : String(value).slice(0, ANSWER_MAX);
  await db.$executeRaw`
    UPDATE "exam_sittings"
    SET "answers" = COALESCE("answers", '{}'::jsonb) || jsonb_build_object(${String(n)}::text, ${clean}::text),
        "updatedAt" = now()
    WHERE "id" = ${id} AND "status" = 'IN_PROGRESS'`;
}

/** A choice between themes (B2's letter, B2's speaking part 1): stored with the answers under choice:<block>. */
export async function saveChoice(organizationId: string, userId: string, id: string, blockId: string, index: number, now = new Date()) {
  const s = await ownSitting(organizationId, userId, id);
  const format = formatOf(s.formatCode);
  const def = format.blocks.find((b) => b.id === blockId);
  if (!def) throw new ExamError('No such task.');
  if (!mayTakeNotes(format, clockStateOf(s), def.sectionId, now)) throw new ExamError('Time is up for this part.');
  await db.$executeRaw`
    UPDATE "exam_sittings"
    SET "answers" = COALESCE("answers", '{}'::jsonb) || jsonb_build_object(${`choice:${blockId}`}::text, ${String(Math.max(0, Math.floor(index)))}::text),
        "updatedAt" = now()
    WHERE "id" = ${id} AND "status" = 'IN_PROGRESS'`;
}

const TEXT_MAX = 12_000;

export async function saveWriting(organizationId: string, userId: string, id: string, blockId: string, text: string, now = new Date()) {
  const s = await ownSitting(organizationId, userId, id);
  const format = formatOf(s.formatCode);
  const def = format.blocks.find((b) => b.id === blockId);
  if (!def || !['write', 'mitteilung'].includes(def.layout)) throw new ExamError('No such task.');
  if (!mayAnswer(format, clockStateOf(s), def.sectionId, now)) throw new ExamError('Time is up for this part.');
  const clean = text.slice(0, TEXT_MAX);
  const words = clean.trim() ? clean.trim().split(/\s+/).length : 0;
  await db.examSubmission.upsert({
    where: { sittingId_task: { sittingId: id, task: blockId } },
    create: { organizationId, sittingId: id, kind: 'WRITING', task: blockId, title: def.title, text: clean, words },
    update: { text: clean, words },
  });
}

/** A speaking task's recording, uploaded as it ends; a second take replaces the first. */
export async function storeRecording(input: {
  organizationId: string;
  userId: string;
  userName: string;
  sittingId: string;
  blockId: string;
  bytes: Uint8Array;
  mimeType: string;
  seconds: number;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const s = await ownSitting(input.organizationId, input.userId, input.sittingId);
  const format = formatOf(s.formatCode);
  const def = format.blocks.find((b) => b.id === input.blockId);
  if (!def || def.layout !== 'speak') throw new ExamError('No such task.');
  if (!mayAnswer(format, clockStateOf(s), def.sectionId, now)) throw new ExamError('Time is up for this part.');
  if (input.bytes.byteLength > 15 * 1024 * 1024) throw new ExamError('That recording is too long.');
  const limit = (def.recordSeconds ?? 300) + 30;
  const seconds = Math.max(0, Math.min(limit, Math.round(input.seconds)));
  const ext = /mp4|m4a|aac/.test(input.mimeType) ? 'm4a' : /ogg/.test(input.mimeType) ? 'ogg' : 'webm';
  const fileName = `speaking-${input.blockId}.${ext}`;
  const key = buildObjectKey(input.organizationId, fileName);
  await putObject(key, input.bytes, input.mimeType || 'audio/webm');
  const asset = await db.asset.create({
    data: {
      organizationId: input.organizationId,
      name: `Speaking ${format.name} ${def.part} by ${input.userName}`,
      fileName,
      type: 'AUDIO',
      storageKey: key,
      mimeType: input.mimeType || 'audio/webm',
      sizeBytes: BigInt(input.bytes.byteLength),
      durationSeconds: seconds,
      uploadedById: input.userId,
      transcodeStatus: 'READY',
    },
    select: { id: true },
  });
  await db.examSubmission.upsert({
    where: { sittingId_task: { sittingId: input.sittingId, task: input.blockId } },
    create: { organizationId: input.organizationId, sittingId: input.sittingId, kind: 'SPEAKING', task: input.blockId, title: def.title, recordingAssetId: asset.id, seconds },
    update: { recordingAssetId: asset.id, seconds, text: '', aiPoints: null, aiMax: null, aiFeedback: undefined, aiError: null, aiAt: null },
  });
}

export async function saveNotes(organizationId: string, userId: string, id: string, sectionId: string, notes: string, now = new Date()) {
  const s = await ownSitting(organizationId, userId, id);
  const format = formatOf(s.formatCode);
  if (!mayTakeNotes(format, clockStateOf(s), sectionId, now)) throw new ExamError('Time is up for this part.');
  await db.$executeRaw`
    UPDATE "exam_sittings"
    SET "notes" = COALESCE("notes", '{}'::jsonb) || jsonb_build_object(${sectionId}::text, ${notes.slice(0, 4000)}::text)
    WHERE "id" = ${id} AND "status" = 'IN_PROGRESS'`;
}

/**
 * A listening block about to be played. In exam mode a block plays as
 * often as the exam allows and no more; the count is kept here, so a
 * reload does not hand out another hearing.
 */
export async function claimPlay(organizationId: string, userId: string, id: string, blockId: string, now = new Date()): Promise<{ ok: boolean; left: number | null }> {
  const s = await ownSitting(organizationId, userId, id);
  const format = formatOf(s.formatCode);
  const def = format.blocks.find((b) => b.id === blockId);
  if (!def) throw new ExamError('No such task.');
  if (s.mode === 'practice') return { ok: true, left: null };
  if (!mayAnswer(format, clockStateOf(s), def.sectionId, now)) return { ok: false, left: 0 };
  /* Plays are counted per run: a block heard twice (plays 2) is one run, repeated by the player itself. */
  const plays = (s.plays ?? {}) as Record<string, number>;
  const used = plays[blockId] ?? 0;
  if (used >= 1) return { ok: false, left: 0 };
  const claimed = await db.$executeRaw`
    UPDATE "exam_sittings"
    SET "plays" = COALESCE("plays", '{}'::jsonb) || jsonb_build_object(${blockId}::text, 1)
    WHERE "id" = ${id} AND "status" = 'IN_PROGRESS' AND NOT (COALESCE("plays", '{}'::jsonb) ? ${blockId})`;
  return { ok: claimed === 1, left: 0 };
}

export async function recordGuard(organizationId: string, userId: string, id: string, kind: 'leave' | 'copy' | 'translate') {
  await ownSitting(organizationId, userId, id);
  await db.$executeRaw`
    UPDATE "exam_sittings"
    SET "guard" = COALESCE("guard", '{}'::jsonb) || jsonb_build_object(${kind}::text, COALESCE(("guard"->>${kind})::int, 0) + 1)
    WHERE "id" = ${id} AND "status" = 'IN_PROGRESS'`;
}

/* ------------------------------------------------------------- handing in */

/**
 * Hand a paper in: counted at once, without the model, so the result page
 * has the objective part straight away. Returns the slow half (the model
 * marking the writing and speaking) for the caller to run after replying.
 */
export async function handIn(organizationId: string, userId: string, id: string, now = new Date()): Promise<() => Promise<void>> {
  const s = await ownSitting(organizationId, userId, id);
  const minutes = Math.max(1, Math.round((now.getTime() - s.startedAt.getTime()) / 60_000));
  await db.examSitting.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: now, minutes } });
  await scoreSitting(organizationId, id, { callModel: false });
  return () => scoreSitting(organizationId, id);
}

/** The speaking task's text for the marker: the chosen theme's, when the block offers a choice. */
function speakingTask(def: ExamBlockDef, block: PaperBlock, choice: number | null): string {
  if (def.themes?.length && choice != null && def.themes[choice]) {
    const t = def.themes[choice];
    return [t.title, t.task.replace(/<[^>]+>/g, ''), t.card.map((c) => `- ${c}`).join('\n')].join('\n\n');
  }
  return taskTextOf(block as unknown as Record<string, unknown>);
}

/**
 * Mark what the model can mark and work the result out. Safe to call again:
 * a submission already marked by the model or a tutor is left alone, and
 * the totals are recomputed from what is there. Called at hand-in, by the
 * cron for anything the model could not reach at the time, and after a
 * tutor marks.
 */
export async function scoreSitting(organizationId: string, id: string, opts: { callModel?: boolean } = {}): Promise<void> {
  const s = await loadSittingRow(organizationId, id);
  if (!s || s.status === 'IN_PROGRESS' || s.status === 'VOID') return;
  const format = formatOf(s.formatCode);
  const paper = paperOf(s);
  const answers = (s.answers ?? {}) as Answers;
  const inScope = s.sectionId ? [s.sectionId] : null;
  const marking = markPaper(paper, answers, inScope);

  const subs = await db.examSubmission.findMany({ where: { organizationId, sittingId: id } });
  const callModel = opts.callModel !== false && (await geminiReady(organizationId));

  for (const sub of subs) {
    if (sub.tutorPoints != null || sub.aiPoints != null || !callModel) continue;
    /* A failure is tried again, but not every five minutes for ever: a recording the model cannot read waits for a tutor. */
    if (sub.aiError && Date.now() - sub.updatedAt.getTime() < 6 * 60 * 60_000) continue;
    const blockId = sub.task.split(':')[0];
    const def = format.blocks.find((b) => b.id === blockId);
    const block = paper.find((p) => p.id === blockId);
    if (!def || !block) continue;
    const criteria = criteriaFor(format, def);
    const choice = answers[`choice:${blockId}`] != null ? Number(answers[`choice:${blockId}`]) : null;
    try {
      if (sub.kind === 'WRITING') {
        if (!sub.text.trim()) continue;
        const task = taskTextOf(block as unknown as Record<string, unknown>, Array.isArray(block.themen) ? (choice ?? 0) : null);
        const length = def.words ? `${def.words.min} bis ${def.words.max} Wörter` : undefined;
        const { json, model } = await askGemini({ organizationId, parts: [{ text: writingPrompt(format, criteria, task, sub.text, length) }], schema: markingSchema(false), purpose: `Marked writing (${format.code} ${blockId})` });
        const r = parseMarking(json, criteria, false);
        await db.examSubmission.update({ where: { id: sub.id }, data: { aiPoints: r.points, aiMax: r.max, aiFeedback: { marks: r.marks, overall: r.overall } as unknown as Prisma.InputJsonValue, aiModel: model, aiAt: new Date(), aiError: null } });
      } else {
        if (!sub.recordingAssetId) continue;
        const asset = await db.asset.findFirst({ where: { id: sub.recordingAssetId, organizationId }, select: { storageKey: true, mimeType: true } });
        const bytes = asset ? await getObject(asset.storageKey, 15 * 1024 * 1024) : null;
        if (!bytes?.byteLength) throw new Error('The recording could not be read.');
        const { json, model } = await askGemini({
          organizationId,
          parts: [{ text: speakingPrompt(format, criteria, speakingTask(def, block, choice), sub.seconds) }, { inline_data: { mime_type: asset?.mimeType || 'audio/webm', data: Buffer.from(bytes).toString('base64') } }],
          schema: markingSchema(true),
          purpose: `Marked speaking (${format.code} ${blockId})`,
        });
        const r = parseMarking(json, criteria, true);
        await db.examSubmission.update({ where: { id: sub.id }, data: { text: r.transcript ?? '', aiPoints: r.points, aiMax: r.max, aiFeedback: { marks: r.marks, overall: r.overall } as unknown as Prisma.InputJsonValue, aiModel: model, aiAt: new Date(), aiError: null } });
      }
    } catch (err) {
      await db.examSubmission.update({ where: { id: sub.id }, data: { aiError: (err instanceof Error ? err.message : String(err)).slice(0, 300) } });
    }
  }

  /* The marks as they stand: a tutor's wins; a task never attempted is nought; one attempted and not yet marked is open. */
  const fresh = await db.examSubmission.findMany({ where: { organizationId, sittingId: id }, select: { task: true, kind: true, text: true, recordingAssetId: true, aiPoints: true, tutorPoints: true } });
  const markedBlocks = format.blocks.filter((b) => !isAuto(b.layout) && (!inScope || inScope.includes(b.sectionId)));
  const marked = markedBlocks.map((b) => {
    const sub = fresh.find((x) => x.task.split(':')[0] === b.id);
    if (!sub) return { blockId: b.id, points: 0 };
    const attempted = sub.kind === 'WRITING' ? Boolean(sub.text.trim()) : Boolean(sub.recordingAssetId);
    if (!attempted) return { blockId: b.id, points: 0 };
    return { blockId: b.id, points: sub.tutorPoints ?? sub.aiPoints ?? null };
  });

  const points = modulePoints(format, marking, marked, inScope);
  const result = inScope ? null : resultOf(format, points);
  const scopedModules = format.scoring.modules.filter((m) => format.blocks.some((b) => b.moduleId === m.id && (!inScope || inScope.includes(b.sectionId))));
  const complete = scopedModules.every((m) => points[m.id] != null);
  const scopedTotal = complete ? Math.round(scopedModules.reduce((a, m) => a + Number(points[m.id]), 0) * 100) / 100 : null;

  await db.examSitting.update({
    where: { id },
    data: {
      points: points as unknown as Prisma.InputJsonValue,
      correct: marking.correct,
      questions: marking.items,
      total: result ? result.total : scopedTotal,
      maxPoints: inScope ? scopedModules.reduce((a, m) => a + m.max, 0) : format.scoring.total,
      passed: result ? result.passed : null,
      conditions: result ? (result.conditions as unknown as Prisma.InputJsonValue) : undefined,
      status: complete ? 'EVALUATED' : 'SUBMITTED',
    },
  });
}

/**
 * The cron's share: papers left open past any possible clock are handed in
 * as they stand, and papers whose writing or speaking the model could not
 * reach at the time are marked now. A few at a time.
 */
export async function sweepSittings(now = new Date(), markLimit = 3): Promise<{ closed: number; marked: number }> {
  let closed = 0;
  let marked = 0;
  // tenant-safe: the cron sweeps every academy's open papers; each is then scored under its own organisation id
  const open = await db.examSitting.findMany({
    where: { status: 'IN_PROGRESS', startedAt: { lt: new Date(now.getTime() - 3 * 60 * 60_000) } },
    select: { id: true, organizationId: true, formatCode: true, startedAt: true, sectionId: true },
    take: 50,
  });
  for (const s of open) {
    const format = examFormat(s.formatCode);
    if (!format || latestEnd(format, s.startedAt, s.sectionId) > now) continue;
    await db.examSitting.update({ where: { id: s.id }, data: { status: 'EXPIRED', submittedAt: now } });
    await scoreSitting(s.organizationId, s.id, { callModel: false });
    closed++;
  }
  /* Oldest-touched first, so one paper the model keeps failing on cannot hold up the rest. */
  // tenant-safe: the cron sweeps every academy's unmarked papers; each is then scored under its own organisation id
  const waiting = await db.examSitting.findMany({
    where: { status: 'SUBMITTED', updatedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
    select: { id: true, organizationId: true },
    orderBy: { updatedAt: 'asc' },
    take: markLimit,
  });
  for (const s of waiting) {
    await scoreSitting(s.organizationId, s.id);
    marked++;
  }
  return { closed, marked };
}
