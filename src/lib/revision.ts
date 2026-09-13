import { extractJson } from '@/lib/ai-evaluation';

/**
 * Spaced revision: the scheduling with no database in it.
 *
 * SM-2, the algorithm behind Anki and most of what came after: a card
 * remembered gets a longer gap next time, a card forgotten goes back to the
 * start and its ease drops. Four answers rather than six, because a learner
 * on a phone between classes does not want to grade themselves on a scale.
 */

export type Grade = 0 | 1 | 2 | 3; // again, hard, good, easy

export interface ReviewState {
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
}

export const FRESH: ReviewState = { intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 };

const DAY = 86_400_000;

/** The next state and when the card is due again. */
export function schedule(state: ReviewState, grade: Grade, now = new Date()): ReviewState & { due: Date } {
  let { intervalDays, ease, reps, lapses } = state;

  if (grade === 0) {
    // Forgotten: back to the start, ease knocked down, seen again in ten minutes.
    lapses += 1;
    reps = 0;
    intervalDays = 0;
    ease = Math.max(1.3, ease - 0.2);
    return { intervalDays, ease, reps, lapses, due: new Date(now.getTime() + 10 * 60_000) };
  }

  reps += 1;
  if (reps === 1) intervalDays = grade === 3 ? 4 : 1;
  else if (reps === 2) intervalDays = grade === 3 ? 10 : grade === 1 ? 3 : 6;
  else {
    const factor = grade === 1 ? 1.2 : grade === 3 ? ease * 1.3 : ease;
    intervalDays = Math.max(intervalDays + 1, Math.round(intervalDays * factor));
  }
  // Ease moves a little each time: hard eats into it, easy adds to it.
  ease = Math.max(1.3, Math.min(3.0, ease + (grade === 1 ? -0.15 : grade === 3 ? 0.15 : 0)));
  intervalDays = Math.min(intervalDays, 365);
  return { intervalDays, ease, reps, lapses, due: new Date(now.getTime() + intervalDays * DAY) };
}

export interface QueueCard {
  id: string;
  due: Date | null;
  reps: number;
}

/**
 * What to show this session: cards that are due, oldest due first, then
 * new cards up to a daily cap so a fresh course does not bury someone in
 * two hundred cards on day one.
 */
export function buildQueue<T extends QueueCard>(cards: T[], now: Date, opts: { limit?: number; newPerSession?: number } = {}): T[] {
  const limit = opts.limit ?? 30;
  const newCap = opts.newPerSession ?? 10;
  const due = cards.filter((c) => c.due && c.due.getTime() <= now.getTime()).sort((a, b) => a.due!.getTime() - b.due!.getTime());
  const fresh = cards.filter((c) => !c.due).slice(0, newCap);
  return [...due, ...fresh].slice(0, limit);
}

export interface Standing {
  total: number;
  due: number;
  fresh: number;
  /** Cards with an interval of three weeks or more: as good as known. */
  known: number;
}

export function standing(cards: { due: Date | null; intervalDays: number }[], now: Date): Standing {
  let due = 0;
  let fresh = 0;
  let known = 0;
  for (const c of cards) {
    if (!c.due) fresh += 1;
    else if (c.due.getTime() <= now.getTime()) due += 1;
    if (c.intervalDays >= 21) known += 1;
  }
  return { total: cards.length, due, fresh, known };
}

export function dueLabel(due: Date, now: Date): string {
  const days = Math.round((due.getTime() - now.getTime()) / DAY);
  if (days <= 0) return 'now';
  if (days === 1) return 'tomorrow';
  if (days < 30) return `in ${days} days`;
  return `in ${Math.round(days / 30)} months`;
}

export const FRONT_MAX = 500;
export const BACK_MAX = 2000;

export function cardProblem(front: string, back: string): string | null {
  if (!front.trim()) return 'Write the front of the card: the question or the word.';
  if (!back.trim()) return 'Write the back: the answer.';
  if (front.length > FRONT_MAX) return `Keep the front under ${FRONT_MAX} characters.`;
  if (back.length > BACK_MAX) return `Keep the back under ${BACK_MAX} characters.`;
  return null;
}

/* Drafting from a lesson ---------------------------------------------------- */

export function flashcardPrompt(input: { lessonTitle: string; text: string; count: number }): { system: string; user: string } {
  return {
    system:
      'You write revision flashcards from a lesson transcript. Answer with one JSON object and nothing else: {"cards": [{"front": string, "back": string, "hint": string}]}. The front is one thing to recall: a term to define, a word to translate, a question with a short answer. The back is the answer in one or two sentences, as the lesson gave it. The hint is optional and short. Only what the lesson teaches; nothing from outside it. Write in the language of the transcript. No markdown.',
    user: `Lesson: ${input.lessonTitle}\nWrite ${input.count} cards.\n\nTranscript:\n${input.text}`,
  };
}

export interface DraftCard {
  front: string;
  back: string;
  hint: string | null;
}

export function parseFlashcards(raw: string, max = 40): DraftCard[] {
  const json = extractJson(raw);
  if (!json || !Array.isArray(json.cards)) return [];
  const out: DraftCard[] = [];
  const seen = new Set<string>();
  for (const c of json.cards as Record<string, unknown>[]) {
    if (!c || typeof c.front !== 'string' || typeof c.back !== 'string') continue;
    const front = c.front.trim().slice(0, FRONT_MAX);
    const back = c.back.trim().slice(0, BACK_MAX);
    if (!front || !back || seen.has(front.toLowerCase())) continue;
    seen.add(front.toLowerCase());
    out.push({ front, back, hint: typeof c.hint === 'string' && c.hint.trim() ? c.hint.trim().slice(0, 200) : null });
    if (out.length >= max) break;
  }
  return out;
}
