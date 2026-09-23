import { db } from '@/lib/db';
import type { ContentSet } from '@/lib/exams/draw';

/**
 * An academy's content for a format, as the draw wants it: the active sets
 * in draw order, each with its blocks. Held for a minute per academy and
 * format, because every start reads it and it changes only when somebody
 * imports or edits a set (which calls forgetContent).
 */

export interface LoadedSet extends ContentSet {
  id: string;
  /** Block id → the ExamBlock row's id, for the audio. */
  blockRows: Record<string, string>;
}

const cache = new Map<string, { at: number; sets: LoadedSet[] }>();
const TTL_MS = 60_000;

export function forgetContent(organizationId?: string): void {
  if (!organizationId) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(`${organizationId}:`)) cache.delete(k);
}

export async function activeSets(organizationId: string, formatCode: string): Promise<LoadedSet[]> {
  const key = `${organizationId}:${formatCode}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.sets;
  const rows = await db.examSet.findMany({
    where: { organizationId, formatCode, active: true },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, blocks: { select: { id: true, blockId: true, content: true } } },
  });
  const sets: LoadedSet[] = rows
    .filter((s) => s.blocks.length)
    .map((s) => ({
      id: s.id,
      name: s.name,
      blocks: Object.fromEntries(s.blocks.map((b) => [b.blockId, b.content])),
      blockRows: Object.fromEntries(s.blocks.map((b) => [b.blockId, b.id])),
    }));
  cache.set(key, { at: Date.now(), sets });
  return sets;
}

/** How many active sets a format has: zero means it is not offered. */
export async function setCounts(organizationId: string): Promise<Record<string, number>> {
  const rows = await db.examSet.groupBy({ by: ['formatCode'], where: { organizationId, active: true }, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.formatCode, r._count._all]));
}

/**
 * The recordings of the listening blocks in a drawn paper, as asset ids in
 * playing order per block. A block whose files are incomplete gets none,
 * and the player reads its script aloud instead: half a block recorded and
 * half read would be worse than either.
 */
export async function audioForPaper(
  organizationId: string,
  formatCode: string,
  paper: { id: string; setName: string; layout: string }[],
): Promise<Record<string, string[]>> {
  const sets = await activeSets(organizationId, formatCode);
  const wanted: { blockId: string; row: string }[] = [];
  for (const p of paper) {
    if (!p.layout.startsWith('audio')) continue;
    const set = sets.find((s) => s.name === p.setName);
    const row = set?.blockRows[p.id];
    if (row) wanted.push({ blockId: p.id, row });
  }
  if (!wanted.length) return {};
  const files = await db.examAudio.findMany({
    where: { blockRowId: { in: wanted.map((w) => w.row) }, asset: { organizationId, deletedAt: null } },
    orderBy: { part: 'asc' },
    select: { blockRowId: true, part: true, assetId: true },
  });
  const out: Record<string, string[]> = {};
  for (const w of wanted) {
    const mine = files.filter((f) => f.blockRowId === w.row);
    /* Parts must run 0..n-1 without a gap. */
    if (mine.length && mine.every((f, i) => f.part === i)) out[w.blockId] = mine.map((f) => f.assetId);
  }
  return out;
}
