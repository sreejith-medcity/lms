/**
 * What an answer to each kind of question looks like, and what it earns.
 *
 * Ten kinds of question, three ways of marking them. Choice questions carry
 * their key in their options. Blanks, matching and ordering carry it in an
 * answer key, read here. Written, spoken, uploaded and coded answers are
 * marked by a person (or drafted by the AI examiner), so this file only
 * says whether they were answered.
 *
 * Nothing here touches the database, so the paper, the review, the marking
 * screen and the tests all agree on what "correct" means.
 */

export type QuestionType =
  | 'MCQ_SINGLE'
  | 'MCQ_MULTI'
  | 'TRUE_FALSE'
  | 'FILL_BLANK'
  | 'MATCH'
  | 'ORDERING'
  | 'SHORT_ANSWER'
  | 'LONG_ANSWER'
  | 'FILE_UPLOAD'
  | 'SPEAKING'
  | 'CODING';

export const QUESTION_TYPES: { value: QuestionType; label: string; hint: string }[] = [
  { value: 'MCQ_SINGLE', label: 'Single answer', hint: 'One right option.' },
  { value: 'MCQ_MULTI', label: 'Multiple answers', hint: 'Every right option must be ticked.' },
  { value: 'TRUE_FALSE', label: 'True or false', hint: '' },
  { value: 'FILL_BLANK', label: 'Fill in the blank', hint: 'Write ___ where each blank goes. Marked automatically against the words you accept.' },
  { value: 'MATCH', label: 'Match the pairs', hint: 'Left column to right column. The right column is shown shuffled.' },
  { value: 'ORDERING', label: 'Put in order', hint: 'Items shown shuffled; the learner drags them into order.' },
  { value: 'SHORT_ANSWER', label: 'Short written answer', hint: 'Marked by a trainer, or drafted by the AI examiner.' },
  { value: 'LONG_ANSWER', label: 'Long written answer', hint: 'An essay or a letter. Marked by a trainer, or drafted by the AI examiner.' },
  { value: 'FILE_UPLOAD', label: 'File upload', hint: 'A document, a photo of working, a drawing. Marked by a trainer.' },
  { value: 'SPEAKING', label: 'Spoken answer', hint: 'Recorded in the browser. Marked by a trainer.' },
];

/** Marked by the machine at submit time. */
export const AUTO_MARKED: QuestionType[] = ['MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'FILL_BLANK', 'MATCH', 'ORDERING'];
/** Choice questions: the key is in the options. */
export const CHOICE: QuestionType[] = ['MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE'];
/** Carry their key in `answerKey`. */
export const KEYED: QuestionType[] = ['FILL_BLANK', 'MATCH', 'ORDERING'];
/** Wait for a person. */
export const HUMAN_MARKED: QuestionType[] = ['SHORT_ANSWER', 'LONG_ANSWER', 'FILE_UPLOAD', 'SPEAKING', 'CODING'];

export const isAutoMarked = (t: string) => (AUTO_MARKED as string[]).includes(t);
export const isHumanMarked = (t: string) => (HUMAN_MARKED as string[]).includes(t);

/* Keys ---------------------------------------------------------------------- */

export type AnswerKey =
  | { kind: 'FILL_BLANK'; blanks: string[][]; caseSensitive: boolean }
  | { kind: 'MATCH'; pairs: { left: string; right: string }[] }
  | { kind: 'ORDERING'; items: string[] };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Read a stored key; null when it is missing or not the shape the type needs. */
export function parseAnswerKey(type: string, raw: unknown): AnswerKey | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (type === 'FILL_BLANK') {
    if (!Array.isArray(r.blanks)) return null;
    const blanks = r.blanks.map((b) => (Array.isArray(b) ? b.map(str).filter(Boolean) : [])).filter((b) => b.length > 0);
    return blanks.length ? { kind: 'FILL_BLANK', blanks, caseSensitive: r.caseSensitive === true } : null;
  }
  if (type === 'MATCH') {
    if (!Array.isArray(r.pairs)) return null;
    const pairs = r.pairs
      .map((p) => (p && typeof p === 'object' ? { left: str((p as Record<string, unknown>).left), right: str((p as Record<string, unknown>).right) } : null))
      .filter((p): p is { left: string; right: string } => Boolean(p && p.left && p.right));
    return pairs.length >= 2 ? { kind: 'MATCH', pairs } : null;
  }
  if (type === 'ORDERING') {
    if (!Array.isArray(r.items)) return null;
    const items = r.items.map(str).filter(Boolean);
    return items.length >= 2 ? { kind: 'ORDERING', items } : null;
  }
  return null;
}

/** How many blanks a prompt draws: each run of three or more underscores. */
export function blankCount(prompt: string): number {
  return (prompt.match(/_{3,}/g) ?? []).length;
}

/** The prompt split around its blanks, for drawing an input in each gap. */
export function splitBlanks(prompt: string): string[] {
  return prompt.split(/_{3,}/);
}

/**
 * What is wrong with a key as typed in the editor, or null. The count of
 * blanks in the prompt has to agree with the count of answer lines, or the
 * learner is asked for a word nobody can mark.
 */
export function keyProblem(type: string, prompt: string, key: AnswerKey | null): string | null {
  if (!(KEYED as string[]).includes(type)) return null;
  if (!key) {
    if (type === 'FILL_BLANK') return 'Give the accepted answer for each blank.';
    if (type === 'MATCH') return 'A matching question needs at least two pairs.';
    return 'An ordering question needs at least two items.';
  }
  if (key.kind === 'FILL_BLANK') {
    const n = blankCount(prompt);
    if (n === 0) return 'Write ___ (three underscores) in the question where each blank goes.';
    if (n !== key.blanks.length) return `The question has ${n} blank${n === 1 ? '' : 's'} but ${key.blanks.length} answer line${key.blanks.length === 1 ? '' : 's'}.`;
  }
  if (key.kind === 'ORDERING' && new Set(key.items.map((i) => normalise(i, false))).size !== key.items.length) {
    return 'Two items in the order are the same, so there is no one right order.';
  }
  if (key.kind === 'MATCH' && new Set(key.pairs.map((p) => normalise(p.right, false))).size !== key.pairs.length) {
    return 'Two pairs have the same right-hand side, so there is no one right match.';
  }
  return null;
}

/* Responses ------------------------------------------------------------------ */

export interface UploadedAnswer {
  assetId: string;
  fileName: string;
  sizeBytes?: number;
  durationSeconds?: number;
}

export function uploadedAnswer(response: unknown): UploadedAnswer | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, unknown>;
  if (typeof r.assetId !== 'string' || !r.assetId) return null;
  return {
    assetId: r.assetId,
    fileName: typeof r.fileName === 'string' ? r.fileName : 'file',
    sizeBytes: typeof r.sizeBytes === 'number' ? r.sizeBytes : undefined,
    durationSeconds: typeof r.durationSeconds === 'number' ? r.durationSeconds : undefined,
  };
}

/** Whether the learner put anything down at all. Blank costs nothing. */
export function isAnswered(type: string, response: unknown): boolean {
  if (response == null) return false;
  switch (type) {
    case 'MCQ_SINGLE':
    case 'MCQ_MULTI':
    case 'TRUE_FALSE':
      return Array.isArray(response) && response.length > 0;
    case 'FILL_BLANK':
      return Array.isArray(response) && response.some((v) => str(v).length > 0);
    case 'MATCH':
      return Array.isArray(response) && response.some((v) => typeof v === 'number' && v >= 0);
    case 'ORDERING':
      return Array.isArray(response) && response.length > 0;
    case 'FILE_UPLOAD':
    case 'SPEAKING':
      return uploadedAnswer(response) !== null;
    default:
      return typeof response === 'string' && response.trim().length > 0;
  }
}

/* Marking -------------------------------------------------------------------- */

export function normalise(text: string, caseSensitive: boolean): string {
  const t = text
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/g, '')
    .trim();
  return caseSensitive ? t : t.toLocaleLowerCase();
}

export interface Marked {
  /** True when everything was right, false when anything was wrong, null for blank. */
  isCorrect: boolean | null;
  marksAwarded: number;
  /** Of the parts (blanks, pairs), how many were right. */
  parts: { right: number; total: number };
}

/**
 * The mark for an auto-marked question.
 *
 * Choice questions are all or nothing. Blanks and pairs earn a share per
 * part right, because "three of four blanks" is a fact worth a mark and an
 * exam that gives zero for it is measuring stamina, not knowledge. Ordering
 * is all or nothing, since a sequence with one item out of place is not a
 * partly right sequence. A wrong answer costs the negative mark; a blank
 * costs nothing, which is what makes negative marking a decision rather
 * than a punishment.
 */
export function markAuto(input: {
  type: string;
  marks: number;
  negativeMarks: number;
  options: { id: string; isCorrect: boolean }[];
  answerKey: unknown;
  response: unknown;
}): Marked {
  const { type, marks, negativeMarks } = input;
  const blank = { isCorrect: null, marksAwarded: 0, parts: { right: 0, total: 0 } } as Marked;
  if (!isAnswered(type, input.response)) return blank;
  const wrong = (parts: Marked['parts']) => ({ isCorrect: false, marksAwarded: -negativeMarks, parts });

  if ((CHOICE as string[]).includes(type)) {
    const chosen = new Set((input.response as unknown[]).map(String));
    const correct = new Set(input.options.filter((o) => o.isCorrect).map((o) => o.id));
    const right = chosen.size === correct.size && [...chosen].every((id) => correct.has(id));
    return right ? { isCorrect: true, marksAwarded: marks, parts: { right: 1, total: 1 } } : wrong({ right: 0, total: 1 });
  }

  const key = parseAnswerKey(type, input.answerKey);
  if (!key) return blank;

  if (key.kind === 'FILL_BLANK') {
    const given = input.response as unknown[];
    let right = 0;
    key.blanks.forEach((accepted, i) => {
      const g = normalise(str(given[i]), key.caseSensitive);
      if (g && accepted.some((a) => normalise(a, key.caseSensitive) === g)) right += 1;
    });
    const total = key.blanks.length;
    if (right === 0) return wrong({ right, total });
    return { isCorrect: right === total, marksAwarded: round(marks * (right / total)), parts: { right, total } };
  }

  if (key.kind === 'MATCH') {
    const given = input.response as unknown[];
    let right = 0;
    key.pairs.forEach((_, i) => {
      if (given[i] === i) right += 1;
    });
    const total = key.pairs.length;
    if (right === 0) return wrong({ right, total });
    return { isCorrect: right === total, marksAwarded: round(marks * (right / total)), parts: { right, total } };
  }

  // ORDERING
  const given = (input.response as unknown[]).map(Number);
  const right = given.length === key.items.length && given.every((v, i) => v === i);
  return right ? { isCorrect: true, marksAwarded: marks, parts: { right: 1, total: 1 } } : wrong({ right: 0, total: 1 });
}

const round = (n: number) => Math.round(n * 100) / 100;

/* Shuffling ------------------------------------------------------------------ */

/**
 * A stable shuffle for the right-hand column of a match and the items of an
 * ordering, so the learner sees the same arrangement on every reload of
 * the same attempt and the answer they saved still points at the same
 * things. Returns the original indexes in display order.
 */
export function displayOrder(count: number, seed: string): number[] {
  let h = 7;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const out = Array.from({ length: count }, (_, i) => i);
  for (let i = out.length - 1; i > 0; i -= 1) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  // A shuffle that lands on the answer is a gift; nudge it once.
  if (count > 1 && out.every((v, i) => v === i)) [out[0], out[1]] = [out[1], out[0]];
  return out;
}

/* Sections ------------------------------------------------------------------- */

export interface SectionClock {
  id: string;
  durationMinutes: number | null;
  startedAt: Date | null;
}

export type SectionState = 'OPEN' | 'NOT_STARTED' | 'CLOSED';

/** Where one section stands: open to answer, waiting to be started, or over. */
export function sectionState(s: SectionClock, now: Date = new Date()): SectionState {
  if (!s.durationMinutes) return 'OPEN';
  if (!s.startedAt) return 'NOT_STARTED';
  return now.getTime() >= s.startedAt.getTime() + s.durationMinutes * 60_000 ? 'CLOSED' : 'OPEN';
}

export function sectionEndsAt(s: SectionClock): Date | null {
  if (!s.durationMinutes || !s.startedAt) return null;
  return new Date(s.startedAt.getTime() + s.durationMinutes * 60_000);
}

/** The stored clock as a map of section id to start time. */
export function readSectionClock(raw: unknown): Record<string, Date> {
  const out: Record<string, Date> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const d = typeof v === 'string' ? new Date(v) : null;
    if (d && !Number.isNaN(d.getTime())) out[k] = d;
  }
  return out;
}

export const ANSWER_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const SPEAKING_MAX_SECONDS = 5 * 60;
