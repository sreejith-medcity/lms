import type { ExamBlockDef, ExamFormat } from '@/lib/exams/types';
import { isAuto } from '@/lib/exams/types';

/**
 * The draw: from a format, its sets and a code, one paper.
 *
 * The paper is a pure function of the three, so the server draws the same
 * paper again to mark it and never takes the browser's word for a score,
 * and a tutor can hand a class one code and know they all sat the same
 * thing. The randomness comes from the code alone (a 32-bit hash into a
 * small generator), never from a key, so the shuffle of options, adverts
 * and headings is the same whether or not the keys are present.
 *
 * This is the telc simulator's generator carried over unchanged in its
 * arithmetic: the same code on the same sets gives the same paper here as
 * it did there, which is what keeps every code a tutor has already given
 * out meaning the same paper.
 */

export interface ContentSet {
  name: string;
  /** Block id → content, in the layout's shape. */
  blocks: Record<string, unknown>;
}

export interface PaperItem {
  /** The item's number through the paper (answers are keyed on it). */
  n: number;
  /** The number shown, restarting per number group. */
  no: number;
  i?: number;
  q?: string;
  opts?: { k: string; t?: string; h?: string }[];
  key?: string;
  alt?: string[];
  why?: string;
  [extra: string]: unknown;
}

export interface PaperBlock extends ExamBlockDef {
  /** Which set the block came from. */
  setName: string;
  items?: PaperItem[];
  [content: string]: unknown;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

type Lettered = { k: string; [x: string]: unknown };

/** Shuffle a lettered list and letter it afresh; the map says where each old letter went. */
function reletter<T extends Lettered>(list: T[], rnd: () => number): { out: T[]; map: Record<string, string> } {
  const order = shuffled(list, rnd);
  const map: Record<string, string> = {};
  order.forEach((e, ix) => {
    map[e.k] = LETTERS[ix];
  });
  return { out: order.map((e, ix) => ({ ...e, k: LETTERS[ix] })), map };
}

/** A code for a fresh paper: six characters, no letters that look like digits. */
export function newDrawCode(rnd: () => number = Math.random): string {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += c[Math.floor(rnd() * c.length)];
  return s;
}

export function normaliseDrawCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

/* The kind of letter a B2 theme asks for, from its own field or its title. */
const KIND_BY_TITLE: [string, RegExp][] = [
  ['beschwerde', /^\s*Beschwerde\b/i],
  ['widerspruch', /^\s*Widerspruch\b/i],
  ['leserbrief', /^\s*Leserbrief\b/i],
  ['stellungnahme', /^\s*Stellungnahme\b/i],
  ['bewerbung', /^\s*Bewerbung\b/i],
  ['anfrage', /^\s*Anfrage\b/i],
];

type Theme = { titel?: string; art?: string; [x: string]: unknown };

export function letterKind(theme: Theme | null | undefined): string | null {
  if (!theme) return null;
  if (theme.art) return theme.art;
  const title = String(theme.titel ?? '');
  for (const [name, rx] of KIND_BY_TITLE) if (rx.test(title)) return name;
  return null;
}

/**
 * Draw the paper for a code. `sets` are the academy's active sets for the
 * format in position order; a block missing from every set is left out of
 * the paper (and the format's page says the set is incomplete).
 */
export function drawPaper(format: ExamFormat, sets: ContentSet[], code: string): PaperBlock[] {
  const level = format.level ?? format.code;
  const rnd = mulberry32(hash32(`telc-${level}|${code}`));
  const out: PaperBlock[] = [];
  let n = 0;
  let group: string | null = null;
  let gn = 0;

  for (const def of format.blocks) {
    const variants = sets.map((s, ix) => ({ set: s, ix, content: s.blocks[def.id] })).filter((v) => v.content != null);
    if (!variants.length) continue;
    const pick = variants[Math.floor(rnd() * variants.length)];
    const p = { ...def, ...(clone(pick.content) as Record<string, unknown>), setName: pick.set.name } as PaperBlock;

    /* B2's letter: two themes to choose from, one of which must be of the
       guaranteed kind (a complaint). They are drawn one from each pot,
       across every set, rather than as a pair from one set: seven of the
       twenty B2 sets have no complaint at all. Which is A and which is B
       is the same randomness, so browser and server agree. */
    if (def.guaranteed && Array.isArray(p.themen)) {
      const all: Theme[] = [];
      variants.forEach((v) => {
        const themes = (v.content as { themen?: Theme[] }).themen ?? [];
        themes.forEach((t) => all.push({ ...t, art: letterKind(t) ?? undefined, satz: v.set.name }));
      });
      const must = all.filter((t) => t.art === def.guaranteed);
      const rest = all.filter((t) => t.art !== def.guaranteed);
      if (must.length && rest.length) {
        const a = clone(must[Math.floor(rnd() * must.length)]);
        const c = clone(rest[Math.floor(rnd() * rest.length)]);
        p.themen = rnd() < 0.5 ? [a, c] : [c, a];
        p.setName = (p.themen as Theme[]).map((t) => String(t.satz)).join('+');
      }
    }

    const items = p.items as PaperItem[] | undefined;
    if (p.layout === 'match' && items) {
      const r = reletter(p.bank as Lettered[], rnd);
      p.bank = r.out;
      const texts = p.texts as { tag: string }[];
      const pairs = items.map((it) => ({ it, tx: texts[(it.i ?? 1) - 1] }));
      const mixed = shuffled(pairs, rnd);
      p.texts = mixed.map((pr, ix) => ({ ...pr.tx, tag: `Text ${ix + 1}` }));
      p.items = mixed.map((pr, ix) => ({ ...pr.it, i: ix + 1, q: `Text ${ix + 1}`, key: pr.it.key ? r.map[pr.it.key] : undefined }));
    } else if (p.layout === 'ads' && items) {
      const r = reletter(p.ads as Lettered[], rnd);
      p.ads = r.out;
      p.items = shuffled(items, rnd).map((it, ix) => ({ ...it, i: ix + 1, key: it.key === 'x' ? 'x' : it.key ? r.map[it.key] : undefined }));
    } else if (p.layout === 'clozeBank' && items) {
      const r = reletter(p.bank as Lettered[], rnd);
      p.bank = r.out;
      p.items = items.map((it) => ({ ...it, key: it.key ? r.map[it.key] : undefined }));
    } else if (['mc', 'cloze3', 'audioMC', 'infoMC'].includes(p.layout) && items) {
      p.items = items.map((it) => {
        const r = reletter((it.opts ?? []) as Lettered[], rnd);
        return { ...it, opts: r.out as PaperItem['opts'], key: it.key ? r.map[it.key] : undefined };
      });
    } else if (p.layout === 'audioMatch' && items) {
      /* The list is lettered afresh; the items keep their order, which follows the recording. */
      const r = reletter(p.bank as Lettered[], rnd);
      p.bank = r.out;
      p.items = items.map((it) => ({ ...it, key: it.key ? r.map[it.key] : undefined }));
    } else if (p.layout === 'adsAB' && items) {
      p.items = items.map((it) => {
        const r = reletter((it.opts ?? []) as Lettered[], rnd);
        return { ...it, opts: r.out as PaperItem['opts'], key: it.key ? r.map[it.key] : undefined };
      });
    }

    const drawn = p.items as PaperItem[] | undefined;
    if (drawn) {
      const base = n;
      const grp = def.numberGroup ?? 'all';
      if (grp !== group) {
        group = grp;
        gn = 0;
      }
      const gbase = gn;
      p.items = drawn.map((it, ix) => ({ ...it, n: base + ix + 1, no: gbase + ix + 1 }));
      n += drawn.length;
      gn += drawn.length;
      const renumber = (txt: string) => txt.replace(/\[\[(\d+)\]\]/g, (_m, x: string) => `[[${base + Number(x)}]]`);
      const letter = p.letter as { title: string; lines: string[] } | undefined;
      if (letter) p.letter = { title: letter.title, lines: letter.lines.map(renumber) };
      const note = p.notiz as { title: string; lines: string[] } | undefined;
      if (note) p.notiz = { title: note.title, lines: note.lines.map(renumber) };
      const form = p.formular as { title: string; rows: (string | number | null)[][] } | undefined;
      if (form) p.formular = { title: form.title, rows: form.rows.map((r) => (r[1] === null ? [r[0], null, base + Number(r[2])] : r)) };
    }
    out.push(p);
  }
  return out;
}

/** The paper as the browser may have it: no keys, no reasons, no model answers. */
export function withoutKeys(paper: PaperBlock[]): PaperBlock[] {
  return paper.map((p) => {
    const k = clone(p) as PaperBlock;
    if (Array.isArray(k.items)) {
      k.items = k.items.map((it) => {
        const o = { ...it };
        delete o.key;
        delete o.alt;
        delete o.why;
        return o;
      });
    }
    delete k.muster;
    if (Array.isArray(k.themen)) {
      k.themen = (k.themen as Record<string, unknown>[]).map((t) => {
        const o = { ...t };
        delete o.muster;
        return o;
      });
    }
    return k;
  });
}

/** The model answers, by block (and by theme index for a choice), for the result page. */
export function modelAnswers(paper: PaperBlock[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of paper) {
    if (typeof p.muster === 'string') out[p.id] = p.muster;
    if (Array.isArray(p.themen)) {
      (p.themen as { muster?: string }[]).forEach((t, i) => {
        if (t?.muster) out[`${p.id}:${i}`] = t.muster;
      });
    }
  }
  return out;
}

export function scoredBlocks(paper: PaperBlock[], sectionIds?: string[] | null): PaperBlock[] {
  const only = sectionIds && sectionIds.length ? new Set(sectionIds) : null;
  return paper.filter((p) => (!only || only.has(p.sectionId)) && isAuto(p.layout));
}
