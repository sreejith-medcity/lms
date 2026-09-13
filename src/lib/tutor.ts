import { extractJson } from '@/lib/ai-evaluation';
import { paragraphs, type Segment } from '@/lib/captions';

/**
 * The tutor and the lesson tools: prompts, the context they are given, and
 * the reading of what comes back. No database, no network.
 *
 * The tutor answers from the course and nothing else. That is the whole
 * design: a model that knows everything will happily explain the German
 * subjunctive in a way the trainer never taught, and the learner then sits
 * an exam marked to what the trainer taught. So the material is the
 * ground, the answer cites where in it the point was made, and "it is not
 * in the course" is an allowed answer.
 */

export const TUTOR_MAX_CHARS = 14_000;
export const TUTOR_QUESTION_MAX = 1000;
export const TUTOR_HISTORY = 8;

export interface LessonContext {
  materialId: string;
  title: string;
  /** Plain text of a text lesson, or empty. */
  body: string;
  segments: Segment[];
}

export interface ContextBlock {
  materialId: string;
  title: string;
  start: number | null;
  text: string;
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * What the tutor reads before answering: this lesson's text in full (up to
 * a budget), then the passages elsewhere in the course that mention the
 * words in the question. Budgeted in characters, since that is what costs.
 */
export function buildContext(question: string, lesson: LessonContext, others: LessonContext[], budget = TUTOR_MAX_CHARS): ContextBlock[] {
  const blocks: ContextBlock[] = [];
  let used = 0;
  const push = (b: ContextBlock) => {
    if (used + b.text.length > budget) return false;
    blocks.push(b);
    used += b.text.length;
    return true;
  };

  if (lesson.body.trim()) push({ materialId: lesson.materialId, title: lesson.title, start: null, text: lesson.body.trim().slice(0, budget / 2) });
  for (const p of paragraphs(lesson.segments, { maxChars: 600 })) {
    if (!push({ materialId: lesson.materialId, title: lesson.title, start: p.start, text: p.text })) break;
  }

  // Elsewhere in the course, the passages that share the most words with
  // the question, best first.
  const words = retrievalWords(question);
  const candidates: { block: ContextBlock; score: number }[] = [];
  for (const other of others) {
    for (const p of paragraphs(other.segments, { maxChars: 500 })) {
      const score = overlap(p.text, words);
      if (score > 0) candidates.push({ block: { materialId: other.materialId, title: other.title, start: p.start, text: p.text }, score });
    }
    if (other.body.trim()) {
      const score = overlap(other.body, words);
      if (score > 0) candidates.push({ block: { materialId: other.materialId, title: other.title, start: null, text: other.body.trim().slice(0, 1200) }, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates.slice(0, 8)) {
    if (!push(c.block)) break;
  }
  return blocks;
}

/** The words worth looking for: letters only, four characters or more, no repeats. */
export function retrievalWords(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  return Array.from(new Set(words));
}

function overlap(text: string, words: string[]): number {
  if (words.length === 0) return 0;
  const low = text.toLowerCase();
  return words.reduce((n, w) => n + (low.includes(w) ? 1 : 0), 0);
}

export function renderContext(blocks: ContextBlock[]): string {
  return blocks
    .map((b) => `[${b.title}${b.start !== null ? ` @ ${mmss(b.start)}` : ''}]\n${b.text}`)
    .join('\n\n');
}

export function tutorSystemPrompt(input: { academy: string; course: string; lessonTitle: string }): string {
  return [
    `You are the course tutor at ${input.academy}, helping a learner who is on the course "${input.course}", currently in the lesson "${input.lessonTitle}".`,
    'Answer only from the course material you are given below. It is the transcript of the lesson and passages from other lessons. Do not add facts, rules or examples that are not in the material, even if you know them: the learner will be examined on what the trainer taught.',
    'When you use a passage, say where it is, in this exact form: (Lesson title @ m:ss) for a passage with a time, or (Lesson title) for one without. Cite at most three.',
    'If the material does not cover the question, say so in one sentence and suggest asking the trainer in the Q&A tab. Do not guess.',
    'Be brief and warm. Plain sentences, no headings, no bullet points, no markdown. Under 180 words unless asked for more. Reply in the language the learner writes in.',
  ].join('\n');
}

export interface Citation {
  title: string;
  seconds: number | null;
}

/** The citations the tutor wrote, in the form it was asked to use. */
export function parseCitations(answer: string): Citation[] {
  const out: Citation[] = [];
  const re = /\(([^()@]{2,120}?)(?:\s*@\s*(\d{1,3}):(\d{2}))?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const title = m[1].trim();
    const seconds = m[2] !== undefined ? Number(m[2]) * 60 + Number(m[3]) : null;
    if (!out.some((c) => c.title === title && c.seconds === seconds)) out.push({ title, seconds });
  }
  return out;
}

/* Lesson tools -------------------------------------------------------------- */

export function summaryPrompt(input: { lessonTitle: string; text: string }): { system: string; user: string } {
  return {
    system:
      'You write study notes for a lesson from its transcript. Answer with one JSON object and nothing else: {"summary": string, "chapters": [{"title": string, "start": number}], "keyTerms": [string]}. The summary is three to five plain sentences in the language of the transcript, saying what was taught, not that a lesson happened. Chapters are four to eight, each a short title and the start in seconds taken from the timestamps in the text, in order. keyTerms are up to ten words or short phrases a learner should know from this lesson. No markdown.',
    user: `Lesson: ${input.lessonTitle}\n\nTranscript with timestamps in seconds:\n${input.text}`,
  };
}

export interface LessonSummary {
  summary: string;
  chapters: { title: string; start: number }[];
  keyTerms: string[];
}

export function parseSummary(raw: string, durationSeconds: number | null): LessonSummary | null {
  const json = extractJson(raw);
  if (!json || typeof json.summary !== 'string') return null;
  const chapters = Array.isArray(json.chapters)
    ? (json.chapters as { title?: unknown; start?: unknown }[])
        .filter((c) => typeof c?.title === 'string' && typeof c?.start === 'number' && c.start >= 0)
        .map((c) => ({ title: String(c.title).trim().slice(0, 80), start: Math.floor(c.start as number) }))
        .filter((c) => c.title && (durationSeconds === null || c.start <= durationSeconds))
        .sort((a, b) => a.start - b.start)
        .slice(0, 12)
    : [];
  const keyTerms = Array.isArray(json.keyTerms) ? (json.keyTerms as unknown[]).filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean).slice(0, 12) : [];
  return { summary: json.summary.trim().slice(0, 2000), chapters, keyTerms };
}

/** The transcript as the summariser sees it: "[123] text" lines, trimmed to a budget. */
export function transcriptForPrompt(segments: Segment[], budget = 24_000): string {
  const lines: string[] = [];
  let used = 0;
  for (const p of paragraphs(segments, { maxChars: 500 })) {
    const line = `[${Math.floor(p.start)}] ${p.text}`;
    if (used + line.length > budget) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
}

export function quizPrompt(input: { lessonTitle: string; text: string; count: number; language?: string }): { system: string; user: string } {
  return {
    system:
      'You write exam questions from a lesson transcript. Answer with one JSON object and nothing else: {"questions": [{"prompt": string, "options": [string, string, string, string], "answer": number, "explanation": string, "difficulty": "EASY"|"MEDIUM"|"HARD"}]}. Each question tests something the transcript actually teaches, never general knowledge. Four options, one correct, plausible distractors, answer is the zero-based index of the correct option. The explanation says why, briefly, and may quote the lesson. Vary the difficulty. Write in the language of the transcript unless told otherwise. No markdown.',
    user: `Lesson: ${input.lessonTitle}\nWrite ${input.count} questions${input.language ? ` in ${input.language}` : ''}.\n\nTranscript:\n${input.text}`,
  };
}

export interface DraftQuestion {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

export function parseQuiz(raw: string, max = 20): DraftQuestion[] {
  const json = extractJson(raw);
  if (!json || !Array.isArray(json.questions)) return [];
  const out: DraftQuestion[] = [];
  for (const q of json.questions as Record<string, unknown>[]) {
    if (!q || typeof q.prompt !== 'string' || !Array.isArray(q.options)) continue;
    const options = (q.options as unknown[]).filter((o): o is string => typeof o === 'string').map((o) => o.trim()).filter(Boolean);
    const answer = typeof q.answer === 'number' ? q.answer : -1;
    if (options.length < 2 || answer < 0 || answer >= options.length) continue;
    const difficulty = q.difficulty === 'EASY' || q.difficulty === 'HARD' ? q.difficulty : 'MEDIUM';
    out.push({
      prompt: q.prompt.trim().slice(0, 2000),
      options: options.slice(0, 6),
      answer,
      explanation: typeof q.explanation === 'string' ? q.explanation.trim().slice(0, 1000) : '',
      difficulty,
    });
    if (out.length >= max) break;
  }
  return out;
}
