import { createHash } from 'node:crypto';
import type { ExamFormat } from '@/lib/exams/types';
import type { ListeningPart } from '@/lib/exams/listening';
import { isAuto } from '@/lib/exams/types';
import { EXAM_FORMATS, examFormat } from '@/lib/exams/registry';

/**
 * Reading a file of exam content before it goes into the database.
 *
 * The content never lives in the repository (it is public, and the keys
 * are the product), so an academy brings it in as a file. Three shapes
 * are read, because each has a reason to exist:
 *
 *   { "A1": [sets], "B1": [sets] }            the telc export, by level
 *   { "TELC_B1": [sets] }                     by format code
 *   [{ "formatCode": "TELC_B1", "sets": [] }] one entry per format
 *
 * A set is { name, title?, blocks: { blockId: content } }. The order of the
 * sets in the file is their draw order, which is what keeps a code meaning
 * the same paper here as on the site it came from.
 *
 * This part is pure (no database), so it is tested on its own.
 */

export interface IncomingSet {
  name: string;
  title: string;
  blocks: Record<string, unknown>;
}

export interface IncomingFormat {
  formatCode: string;
  sets: IncomingSet[];
}

export interface SetCheck {
  name: string;
  blocks: number;
  /** Block ids the format does not have: left out of the import. */
  unknown: string[];
  /** Auto-marked blocks with items that have no key: they would count nothing. */
  withoutKeys: string[];
}

export interface FileCheck {
  formats: { formatCode: string; name: string; sets: SetCheck[] }[];
  /** Keys in the file that name no format. */
  ignored: string[];
  problems: string[];
}

const MAX_SETS = 200;

function codeFor(key: string): string | null {
  const k = key.trim().toUpperCase();
  if (examFormat(k)) return k;
  /* A bare level is the telc export's shape. */
  if (/^[ABC][12]$/.test(k) && examFormat(`TELC_${k}`)) return `TELC_${k}`;
  return null;
}

function readSets(value: unknown): IncomingSet[] | null {
  if (!Array.isArray(value)) return null;
  const out: IncomingSet[] = [];
  for (const raw of value.slice(0, MAX_SETS)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { name?: unknown; title?: unknown; blocks?: unknown };
    const name = String(r.name ?? '').trim().slice(0, 40);
    if (!name || !r.blocks || typeof r.blocks !== 'object' || Array.isArray(r.blocks)) continue;
    out.push({ name, title: String(r.title ?? '').slice(0, 200), blocks: r.blocks as Record<string, unknown> });
  }
  return out;
}

export function parseContentFile(json: unknown): { formats: IncomingFormat[]; ignored: string[] } {
  const formats: IncomingFormat[] = [];
  const ignored: string[] = [];
  const add = (key: string, value: unknown) => {
    const code = codeFor(key);
    const sets = readSets(value);
    if (!code || !sets) return void ignored.push(key);
    const existing = formats.find((f) => f.formatCode === code);
    if (existing) existing.sets.push(...sets);
    else formats.push({ formatCode: code, sets });
  };
  if (Array.isArray(json)) {
    for (const entry of json) {
      const e = entry as { formatCode?: unknown; sets?: unknown } | null;
      add(String(e?.formatCode ?? ''), e?.sets);
    }
  } else if (json && typeof json === 'object') {
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) add(k, v);
  }
  return { formats, ignored };
}

/** What a set would bring in, and what is wrong with it, without writing anything. */
export function checkSet(format: ExamFormat, set: IncomingSet): SetCheck {
  const known = new Map(format.blocks.map((b) => [b.id, b]));
  const unknown: string[] = [];
  const withoutKeys: string[] = [];
  let blocks = 0;
  for (const [id, content] of Object.entries(set.blocks)) {
    const def = known.get(id);
    if (!def) {
      unknown.push(id);
      continue;
    }
    blocks++;
    if (isAuto(def.layout)) {
      const items = (content as { items?: { key?: unknown }[] } | null)?.items;
      if (!Array.isArray(items) || items.some((it) => it?.key == null || it.key === '')) withoutKeys.push(id);
    }
  }
  return { name: set.name, blocks, unknown, withoutKeys };
}

export function checkFile(json: unknown): FileCheck & { parsed: IncomingFormat[] } {
  const { formats, ignored } = parseContentFile(json);
  const problems: string[] = [];
  if (!formats.length) problems.push(`Nothing in the file names a known test. Expected keys like A1 or ${EXAM_FORMATS[0]?.code ?? 'TELC_A1'}.`);
  const out = formats.map((f) => {
    const format = examFormat(f.formatCode)!;
    const names = new Set<string>();
    for (const s of f.sets) {
      if (names.has(s.name)) problems.push(`${format.name}: the set "${s.name}" appears twice; the later one wins.`);
      names.add(s.name);
    }
    return { formatCode: f.formatCode, name: format.name, sets: f.sets.map((s) => checkSet(format, s)) };
  });
  return { formats: out, ignored, problems, parsed: formats };
}

/** Only the blocks the format knows, ready to store. */
export function storableBlocks(format: ExamFormat, set: IncomingSet): [string, unknown][] {
  const known = new Set(format.blocks.map((b) => b.id));
  return Object.entries(set.blocks).filter(([id, v]) => known.has(id) && v != null && typeof v === 'object');
}

/** A listening piece's fingerprint: a recording belongs to exactly this wording. */
export function partHash(part: ListeningPart): string {
  return createHash('sha256')
    .update(part.lines.map((l) => `${l.sp}: ${l.t}`).join('\n'))
    .digest('hex')
    .slice(0, 32);
}

/** The telc site's bank is JavaScript: one registerLevel line, then one registerSet line per set. */
export function parseBank(text: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('registerSet(') || !t.endsWith(');')) continue;
    try {
      const [, name, bank] = JSON.parse(`[${t.slice('registerSet('.length, -2)}]`) as [string, string, Record<string, unknown>];
      if (typeof name === 'string' && bank && typeof bank === 'object') out.set(name, bank);
    } catch {
      /* A line that is not what we expect is skipped, not fatal. */
    }
  }
  return out;
}
