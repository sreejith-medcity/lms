import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { buildObjectKey, putObject } from '@/lib/storage';
import { examFormat } from '@/lib/exams/registry';
import { LISTENING_LAYOUTS, type ExamBlockDef, type ExamFormat } from '@/lib/exams/types';
import { listeningParts, type ListeningPart, type ScriptLine } from '@/lib/exams/listening';
import { forgetContent } from '@/lib/exams/content';
import { parseBank, partHash, storableBlocks, type IncomingFormat } from '@/lib/exams/import';

/**
 * Writing exam content: the import of a file of sets, switching sets in
 * and out of the draw, and bringing the listening recordings over from
 * the telc site.
 */

function partsOf(def: ExamBlockDef, content: unknown): ListeningPart[] {
  return listeningParts((content as { script?: ScriptLine[] } | null)?.script, def.textCount);
}

export interface ImportReport {
  formats: { formatCode: string; created: number; updated: number; blocks: number; audioDropped: number }[];
}

/**
 * Sets are matched by name within a format: a set that exists is updated in
 * place (its blocks replaced one by one, blocks the file does not carry are
 * left alone), a new one is added. Positions follow the file. A listening
 * block whose script changed loses its recordings, since a candidate would
 * otherwise read one thing and hear another; the block is read aloud until
 * new ones come.
 */
export async function importContent(organizationId: string, userId: string, formats: IncomingFormat[]): Promise<ImportReport> {
  const report: ImportReport = { formats: [] };
  for (const f of formats) {
    const format = examFormat(f.formatCode);
    if (!format) continue;
    const line = { formatCode: f.formatCode, created: 0, updated: 0, blocks: 0, audioDropped: 0 };
    const seen = new Map<string, (typeof f.sets)[number]>();
    for (const s of f.sets) seen.set(s.name, s);
    let position = 0;
    for (const set of seen.values()) {
      const blocks = storableBlocks(format, set);
      if (!blocks.length) continue;
      const existing = await db.examSet.findUnique({
        where: { organizationId_formatCode_name: { organizationId, formatCode: f.formatCode, name: set.name } },
        select: { id: true, blocks: { select: { id: true, blockId: true, audio: { select: { id: true, part: true, scriptHash: true, assetId: true } } } } },
      });
      const row = existing
        ? await db.examSet.update({ where: { id: existing.id }, data: { position, title: set.title || undefined, updatedById: userId }, select: { id: true } })
        : await db.examSet.create({ data: { organizationId, formatCode: f.formatCode, name: set.name, title: set.title, position, updatedById: userId }, select: { id: true } });
      existing ? line.updated++ : line.created++;
      position++;

      for (const [blockId, content] of blocks) {
        const def = format.blocks.find((b) => b.id === blockId)!;
        const old = existing?.blocks.find((b) => b.blockId === blockId);
        if (old && LISTENING_LAYOUTS.includes(def.layout) && old.audio.length) {
          const hashes = partsOf(def, content).map(partHash);
          const stale = old.audio.filter((a) => hashes[a.part] !== a.scriptHash);
          if (stale.length) {
            await db.examAudio.deleteMany({ where: { blockRowId: old.id } });
            await db.asset.updateMany({ where: { id: { in: old.audio.map((a) => a.assetId) }, organizationId }, data: { deletedAt: new Date() } });
            line.audioDropped += old.audio.length;
          }
        }
        await db.examBlock.upsert({
          where: { setId_blockId: { setId: row.id, blockId } },
          create: { setId: row.id, blockId, content: content as Prisma.InputJsonValue },
          update: { content: content as Prisma.InputJsonValue },
        });
        line.blocks++;
      }
    }
    report.formats.push(line);
  }
  forgetContent(organizationId);
  return report;
}

export async function setActive(organizationId: string, setId: string, active: boolean): Promise<void> {
  await db.examSet.updateMany({ where: { id: setId, organizationId }, data: { active } });
  forgetContent(organizationId);
}

/** Per format: sets in the draw and in all, and how many listening parts have their recording. */
export async function contentStatus(organizationId: string): Promise<Record<string, { active: number; sets: number; parts: number; recorded: number }>> {
  const sets = await db.examSet.findMany({
    where: { organizationId },
    select: { formatCode: true, active: true, blocks: { select: { blockId: true, content: true, _count: { select: { audio: true } } } } },
  });
  const out: Record<string, { active: number; sets: number; parts: number; recorded: number }> = {};
  for (const s of sets) {
    const format = examFormat(s.formatCode);
    const line = (out[s.formatCode] ??= { active: 0, sets: 0, parts: 0, recorded: 0 });
    line.sets++;
    if (s.active) line.active++;
    if (!format) continue;
    for (const b of s.blocks) {
      const def = format.blocks.find((d) => d.id === b.blockId);
      if (!def || !LISTENING_LAYOUTS.includes(def.layout)) continue;
      const n = partsOf(def, b.content).length;
      line.parts += n;
      line.recorded += Math.min(n, b._count.audio);
    }
  }
  return out;
}

/* ------------------------------------------------ recordings from the telc site */

export interface PullReport {
  pulled: number;
  remaining: number;
  /** Blocks that cannot be brought over, and why. */
  skipped: string[];
  error?: string;
}

interface Wanted {
  format: ExamFormat;
  setName: string;
  def: ExamBlockDef;
  blockRowId: string;
  part: number;
  hash: string;
  url: string;
}

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Brings the recordings for one format over from the telc site, a batch at
 * a time (a press does what fits in the budget and says how many are left,
 * so the page presses again). A recording is taken only where the site's
 * script for that piece is word for word the script here.
 */
export async function pullAudio(
  organizationId: string,
  userId: string,
  formatCode: string,
  baseUrl: string,
  budget: { files: number; ms: number } = { files: 60, ms: 40_000 },
): Promise<PullReport> {
  const started = Date.now();
  const format = examFormat(formatCode);
  if (!format || format.family !== 'telc' || !format.level) return { pulled: 0, remaining: 0, skipped: [], error: 'Only telc tests have recordings on the telc site.' };
  const base = baseUrl.replace(/\/+$/, '');

  let bank: Map<string, Record<string, unknown>>;
  try {
    const r = await fetch(`${base}/api/bank/${format.level}`, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
    if (!r.ok) return { pulled: 0, remaining: 0, skipped: [], error: `The telc site answered ${r.status}.` };
    bank = parseBank(await r.text());
  } catch (err) {
    return { pulled: 0, remaining: 0, skipped: [], error: `The telc site could not be reached: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!bank.size) return { pulled: 0, remaining: 0, skipped: [], error: 'The telc site sent no sets for this level.' };

  const sets = await db.examSet.findMany({
    where: { organizationId, formatCode },
    select: { name: true, blocks: { select: { id: true, blockId: true, content: true, audio: { select: { part: true, scriptHash: true } } } } },
  });
  const listening = format.blocks.filter((b) => LISTENING_LAYOUTS.includes(b.layout));
  const wanted: Wanted[] = [];
  const skipped: string[] = [];
  for (const s of sets) {
    const remote = bank.get(s.name);
    for (const def of listening) {
      const row = s.blocks.find((b) => b.blockId === def.id);
      if (!row) continue;
      const mine = partsOf(def, row.content);
      const theirs = remote?.[def.id] as { script?: ScriptLine[]; audio?: string[] } | undefined;
      const urls = Array.isArray(theirs?.audio) ? theirs.audio : [];
      if (!mine.length) continue;
      if (!urls.length) {
        skipped.push(`${s.name} ${def.part}: no recording on the telc site`);
        continue;
      }
      const theirParts = partsOf(def, theirs);
      if (urls.length !== mine.length || theirParts.length !== mine.length || theirParts.some((p, i) => partHash(p) !== partHash(mine[i]))) {
        skipped.push(`${s.name} ${def.part}: the script differs from the telc site's`);
        continue;
      }
      mine.forEach((p, i) => {
        const hash = partHash(p);
        const have = row.audio.find((a) => a.part === i);
        if (have && have.scriptHash === hash) return;
        wanted.push({ format, setName: s.name, def, blockRowId: row.id, part: i, hash, url: urls[i] });
      });
    }
  }

  let pulled = 0;
  for (const w of wanted) {
    if (pulled >= budget.files || Date.now() - started > budget.ms) break;
    try {
      const r = await fetch(new URL(w.url, `${base}/`), { signal: AbortSignal.timeout(30_000), redirect: 'follow', cache: 'no-store' });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES) throw new Error('an empty or oversized file');
      const mime = (r.headers.get('content-type') ?? '').split(';')[0].trim() || 'audio/mpeg';
      if (!mime.startsWith('audio/') && mime !== 'application/octet-stream') throw new Error(`not audio (${mime})`);
      const ext = /wav/.test(mime) ? 'wav' : /ogg/.test(mime) ? 'ogg' : /mp4|m4a|aac/.test(mime) ? 'm4a' : 'mp3';
      const fileName = `${w.format.code.toLowerCase()}-${w.setName}-${w.def.id}-${w.part}.${ext}`;
      const key = buildObjectKey(organizationId, fileName);
      await putObject(key, bytes, mime);
      const asset = await db.asset.create({
        data: {
          organizationId,
          name: `${w.format.name}, set ${w.setName}, ${w.def.part} ${w.def.title}, piece ${w.part + 1}`,
          fileName,
          type: 'AUDIO',
          storageKey: key,
          mimeType: mime,
          sizeBytes: BigInt(bytes.byteLength),
          uploadedById: userId,
          transcodeStatus: 'READY',
        },
        select: { id: true },
      });
      await db.examAudio.upsert({
        where: { blockRowId_part: { blockRowId: w.blockRowId, part: w.part } },
        create: { blockRowId: w.blockRowId, part: w.part, assetId: asset.id, scriptHash: w.hash, source: 'telc site' },
        update: { assetId: asset.id, scriptHash: w.hash, source: 'telc site' },
      });
      pulled++;
    } catch (err) {
      skipped.push(`${w.setName} ${w.def.part} piece ${w.part + 1}: ${err instanceof Error ? err.message : String(err)}`);
      /* One file failing is noted; the rest carry on. It is tried again on the next press. */
    }
  }
  forgetContent(organizationId);
  return { pulled, remaining: wanted.length - pulled, skipped: skipped.slice(0, 40) };
}
