import type { ExamFormat } from '@/lib/exams/types';
import { isAuto, isTyped } from '@/lib/exams/types';
import { scoredBlocks, type PaperBlock, type PaperItem } from '@/lib/exams/draw';

/**
 * Counting a paper. The paper comes from the draw and the answers from the
 * browser; what the browser thinks its score is never enters into it.
 */

export type Answers = Record<string, string | number | null | undefined>;

export interface ItemKey {
  key?: string;
  alt: string[] | null;
  why: string | null;
  moduleId: string;
  blockId: string;
}

export interface ModuleCount {
  points: number;
  correct: number;
  items: number;
  name: string;
}

export interface Marking {
  modules: Record<string, ModuleCount>;
  correct: number;
  items: number;
  keys: Record<number, ItemKey>;
}

/** Typed answers compared loosely: case, punctuation and doubled spaces do not decide. */
export function normaliseTyped(v: unknown): string {
  return String(v == null ? '' : v)
    .toLowerCase()
    .replace(/[‘’‚“”„'"`.,;:!?()[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function typedCorrect(item: PaperItem, answer: unknown): boolean {
  const given = normaliseTyped(answer);
  if (!given) return false;
  const accepted = [item.key, ...(item.alt ?? [])].map(normaliseTyped);
  return accepted.includes(given);
}

/** Without a key the answer is wrong, not "maybe": no key, no points. */
export function itemCorrect(block: PaperBlock, item: PaperItem, answer: unknown): boolean {
  if (item.key === undefined || item.key === null) return false;
  return isTyped(block.layout) ? typedCorrect(item, answer) : answer === item.key;
}

export function markPaper(paper: PaperBlock[], answers: Answers, sectionIds?: string[] | null): Marking {
  const modules: Record<string, ModuleCount> = {};
  const keys: Record<number, ItemKey> = {};
  let correct = 0;
  let items = 0;
  for (const p of scoredBlocks(paper, sectionIds)) {
    const worth = p.points;
    const m = p.moduleId;
    for (const it of p.items ?? []) {
      keys[it.n] = { key: it.key, alt: it.alt ?? null, why: it.why ?? null, moduleId: m, blockId: p.id };
      items++;
      const ok = itemCorrect(p, it, answers[String(it.n)]);
      if (ok) correct++;
      modules[m] ??= { points: 0, correct: 0, items: 0, name: p.title };
      modules[m].items++;
      if (ok) {
        modules[m].correct++;
        modules[m].points += worth;
      }
    }
  }
  /* Quarter points add up crooked in floating point. */
  for (const k of Object.keys(modules)) modules[k].points = Math.round(modules[k].points * 100) / 100;
  return { modules, correct, items, keys };
}

export interface Result {
  total: number;
  of: number;
  passed: boolean;
  /** Each condition by name and whether it held. */
  conditions: { name: string; met: boolean; got: number; min: number; max: number }[];
}

/**
 * The result of a whole paper from its module points, or null while any
 * module has no mark yet: anything less than every module is not a
 * result and must not be shown as one.
 */
export function resultOf(format: ExamFormat, points: Record<string, number | null | undefined>): Result | null {
  const modules = format.scoring.modules;
  if (modules.some((m) => points[m.id] === null || points[m.id] === undefined)) return null;
  const total = Math.round(modules.reduce((a, m) => a + Number(points[m.id]), 0) * 100) / 100;
  const conditions = format.scoring.groups
    .filter((g) => g.min != null)
    .map((g) => {
      const got = Math.round(g.moduleIds.reduce((a, id) => a + Number(points[id] ?? 0), 0) * 100) / 100;
      return { name: g.name, met: got >= (g.min ?? 0), got, min: g.min ?? 0, max: g.max };
    });
  const passed = total >= format.scoring.pass && conditions.every((c) => c.met);
  return { total, of: format.scoring.total, passed, conditions };
}

/**
 * The module points of a sitting: the counted ones for every auto module
 * (zero where nothing was answered), and for the marked modules the sum
 * of their tasks' marks once every task has one.
 */
export function modulePoints(
  format: ExamFormat,
  marking: Marking | null,
  marked: { blockId: string; points: number | null }[],
  sectionIds?: string[] | null,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const only = sectionIds && sectionIds.length ? new Set(sectionIds) : null;
  for (const m of format.scoring.modules) {
    const blocks = format.blocks.filter((b) => b.moduleId === m.id && (!only || only.has(b.sectionId)));
    if (!blocks.length) {
      out[m.id] = null;
      continue;
    }
    if (m.source === 'auto') {
      out[m.id] = marking ? Math.round((marking.modules[m.id]?.points ?? 0) * 100) / 100 : null;
      continue;
    }
    /* A marked module: every marked block needs its mark; counted blocks
       inside it (A1's writing is a form and a message) come from the
       count, which only ever holds auto blocks of this module. */
    let sum = 0;
    let complete = true;
    for (const b of blocks) {
      if (isAuto(b.layout)) {
        if (!marking) complete = false;
        continue;
      }
      const mark = marked.find((x) => x.blockId === b.id);
      if (!mark || mark.points == null) {
        complete = false;
        break;
      }
      sum += mark.points;
    }
    if (!complete) {
      out[m.id] = null;
      continue;
    }
    const counted = marking?.modules[m.id]?.points ?? 0;
    out[m.id] = Math.round((sum + counted) * 100) / 100;
  }
  return out;
}
