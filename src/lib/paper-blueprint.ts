/**
 * A mock paper drawn from the bank by a blueprint.
 *
 * A blueprint is a list of sections: "20 questions tagged pharmacology, any
 * difficulty", "10 hard questions from the anatomy bank", and so on. The
 * paper is drawn section by section, at random, never repeating a question,
 * and any section the bank cannot fill is reported as a shortfall rather
 * than quietly filled with something else. Pure, and seeded, so a draw can
 * be reproduced and tested.
 */

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface PoolQuestion {
  id: string;
  bankId: string;
  tags: string[];
  difficulty: Difficulty;
  type: string;
  marks: number;
}

export interface BlueprintSection {
  label: string;
  count: number;
  /** Empty means any bank. */
  bankIds?: string[];
  /** Empty means any tag. A question must carry every tag listed. */
  tags?: string[];
  /** True: any one of the tags is enough. */
  anyTag?: boolean;
  difficulty?: Difficulty | null;
  /** Empty means any type. */
  types?: string[];
}

export function matches(q: PoolQuestion, section: BlueprintSection): boolean {
  if (section.bankIds?.length && !section.bankIds.includes(q.bankId)) return false;
  if (section.difficulty && q.difficulty !== section.difficulty) return false;
  if (section.types?.length && !section.types.includes(q.type)) return false;
  if (section.tags?.length) {
    const have = new Set(q.tags.map((t) => t.toLowerCase()));
    const want = section.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const hit = section.anyTag ? want.some((t) => have.has(t)) : want.every((t) => have.has(t));
    if (!hit) return false;
  }
  return true;
}

/** How many questions each section could draw from, ignoring overlap. */
export function availability(pool: PoolQuestion[], sections: BlueprintSection[]): number[] {
  return sections.map((s) => pool.filter((q) => matches(q, s)).length);
}

export interface Draw {
  picks: { section: number; questionId: string }[];
  shortfalls: { section: number; wanted: number; drawn: number }[];
  totalMarks: number;
}

/** Deterministic, so a paper can be regenerated from its seed. mulberry32. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Sections are drawn tightest first, so a narrow section ("5 hard questions
 * on ECG") is not starved by a broad one ("30 questions, any tag") that ran
 * before it and took them. The picks are then reported in blueprint order.
 */
export function drawPaper(
  pool: PoolQuestion[],
  sections: BlueprintSection[],
  random: () => number = Math.random,
): Draw {
  const taken = new Set<string>();
  const picks: Draw['picks'] = [];
  const shortfalls: Draw['shortfalls'] = [];

  const order = sections
    .map((section, index) => ({ index, section, size: pool.filter((q) => matches(q, section)).length }))
    .sort((a, b) => a.size - b.size || a.index - b.index);

  for (const { index, section } of order) {
    const candidates = shuffle(
      pool.filter((q) => !taken.has(q.id) && matches(q, section)),
      random,
    );
    const chosen = candidates.slice(0, Math.max(0, Math.floor(section.count)));
    for (const q of chosen) {
      taken.add(q.id);
      picks.push({ section: index, questionId: q.id });
    }
    if (chosen.length < section.count) {
      shortfalls.push({ section: index, wanted: section.count, drawn: chosen.length });
    }
  }

  picks.sort((a, b) => a.section - b.section);
  const byId = new Map(pool.map((q) => [q.id, q]));
  const totalMarks = picks.reduce((n, p) => n + (byId.get(p.questionId)?.marks ?? 0), 0);

  return { picks, shortfalls: shortfalls.sort((a, b) => a.section - b.section), totalMarks };
}

/** Blueprints are stored as JSON on the assessment; this reads one back safely. */
export function parseBlueprint(raw: unknown): BlueprintSection[] {
  if (!Array.isArray(raw)) return [];
  const out: BlueprintSection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const count = Number(s.count);
    if (!Number.isFinite(count) || count <= 0) continue;
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean) : [];
    const difficulty = ['EASY', 'MEDIUM', 'HARD'].includes(String(s.difficulty)) ? (String(s.difficulty) as Difficulty) : null;
    out.push({
      label: typeof s.label === 'string' && s.label.trim() ? s.label.trim() : `Section ${out.length + 1}`,
      count: Math.floor(count),
      bankIds: strings(s.bankIds),
      tags: strings(s.tags),
      anyTag: Boolean(s.anyTag),
      difficulty,
      types: strings(s.types),
    });
  }
  return out;
}
