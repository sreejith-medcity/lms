import { parseCsv } from '@/lib/csv';

/**
 * Questions in bulk, from a spreadsheet or a document.
 *
 * Two formats, because that is what the material actually arrives in. A CSV
 * with a header row, one question per line, is what somebody exports from a
 * spreadsheet. A plain numbered list with lettered options is what a trainer
 * already has in a Word file, and the document importer feeds its text here.
 *
 * Nothing is written from this module: it turns text into a list of questions
 * and a list of problems, each with the line it came from, so the person can
 * fix a file of four hundred in the six places that need it before anything
 * is created.
 */

export type ImportType = 'MCQ_SINGLE' | 'MCQ_MULTI' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'LONG_ANSWER';
export type ImportDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface ParsedQuestion {
  /** Where it started in the source, for the problem list. */
  line: number;
  type: ImportType;
  prompt: string;
  options: { label: string; isCorrect: boolean }[];
  explanation: string | null;
  difficulty: ImportDifficulty;
  marks: number;
  negativeMarks: number;
  tags: string[];
}

export interface ImportProblem {
  line: number;
  message: string;
}

export interface ImportParse {
  format: 'CSV' | 'TEXT';
  questions: ParsedQuestion[];
  problems: ImportProblem[];
}

const LETTERS = 'ABCDEFGHIJ';

function cleanTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const t of raw.split(/[,;|]/)) {
    const tag = t.trim().toLowerCase().replace(/\s+/g, ' ');
    if (tag && tag.length <= 40) seen.add(tag);
  }
  return [...seen];
}

function difficultyOf(raw: string | null | undefined): ImportDifficulty | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'MEDIUM';
  if (v === 'easy' || v === 'e' || v === '1') return 'EASY';
  if (v === 'medium' || v === 'm' || v === '2' || v === 'moderate') return 'MEDIUM';
  if (v === 'hard' || v === 'h' || v === '3' || v === 'difficult') return 'HARD';
  return null;
}

function numberOf(raw: string | null | undefined, fallback: number): number | null {
  const v = (raw ?? '').trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * "A", "a,c", "B C", "2", "True", or the option's own text. Returns the
 * indexes that are correct, or null when nothing matched.
 */
function answerIndexes(raw: string, labels: string[]): number[] | null {
  const v = raw.trim();
  if (!v) return null;

  const parts = v.split(/[,;/ ]+/).filter(Boolean);
  const idx: number[] = [];
  let allLetters = true;
  for (const part of parts) {
    const p = part.toUpperCase().replace(/[.)]/g, '');
    if (/^[A-J]$/.test(p)) idx.push(LETTERS.indexOf(p));
    else if (/^\d+$/.test(p)) idx.push(Number(p) - 1);
    else allLetters = false;
  }
  if (allLetters && idx.length && idx.every((i) => i >= 0 && i < labels.length)) {
    return [...new Set(idx)].sort((a, b) => a - b);
  }

  // The option's text, for people who write "Paris" rather than "B".
  const byText = labels.findIndex((l) => l.trim().toLowerCase() === v.toLowerCase());
  return byText >= 0 ? [byText] : null;
}

function isTrueFalse(labels: string[]): boolean {
  if (labels.length !== 2) return false;
  const [a, b] = labels.map((l) => l.trim().toLowerCase());
  return (a === 'true' && b === 'false') || (a === 'false' && b === 'true');
}

/**
 * Settles the type from what the row actually has, then checks the answer
 * fits it. Shared by both formats so a spreadsheet and a document that say
 * the same thing produce the same question.
 */
function finish(
  draft: {
    line: number;
    prompt: string;
    labels: string[];
    correct: number[] | null;
    explicitType?: string | null;
    explanation?: string | null;
    difficulty?: string | null;
    marks?: string | null;
    negative?: string | null;
    tags?: string | null;
  },
  problems: ImportProblem[],
): ParsedQuestion | null {
  const problem = (message: string) => {
    problems.push({ line: draft.line, message });
    return null;
  };

  const prompt = draft.prompt.trim();
  if (prompt.length < 3) return problem('The question text is missing.');

  const labels = draft.labels.map((l) => l.trim()).filter(Boolean);
  const wanted = (draft.explicitType ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');

  let type: ImportType;
  if (wanted === 'SHORT_ANSWER' || wanted === 'SHORT' || wanted === 'LONG_ANSWER' || wanted === 'LONG' || wanted === 'ESSAY') {
    type = wanted.startsWith('LONG') || wanted === 'ESSAY' ? 'LONG_ANSWER' : 'SHORT_ANSWER';
  } else if (wanted === 'TRUE_FALSE' || wanted === 'TF' || wanted === 'TRUEFALSE' || (!wanted && isTrueFalse(labels))) {
    type = 'TRUE_FALSE';
  } else if (labels.length === 0) {
    type = 'SHORT_ANSWER';
  } else if (wanted === 'MCQ_MULTI' || wanted === 'MULTI' || wanted === 'MULTIPLE') {
    type = 'MCQ_MULTI';
  } else if (wanted === 'MCQ_SINGLE' || wanted === 'MCQ' || wanted === 'SINGLE' || !wanted) {
    type = draft.correct && draft.correct.length > 1 ? 'MCQ_MULTI' : 'MCQ_SINGLE';
  } else {
    return problem(`Unknown type "${draft.explicitType}". Use mcq, multi, true_false, short or long.`);
  }

  const difficulty = difficultyOf(draft.difficulty);
  if (!difficulty) return problem(`Difficulty "${draft.difficulty}" is not easy, medium or hard.`);

  const marks = numberOf(draft.marks, 1);
  if (marks === null || marks <= 0) return problem('Marks must be a number above zero.');
  const negative = numberOf(draft.negative, 0);
  if (negative === null) return problem('Negative marks must be a number.');

  const isObjective = type === 'MCQ_SINGLE' || type === 'MCQ_MULTI' || type === 'TRUE_FALSE';

  let options: ParsedQuestion['options'] = [];
  if (type === 'TRUE_FALSE') {
    let truth: boolean | null = null;
    if (labels.length === 2 && isTrueFalse(labels) && draft.correct?.length === 1) {
      truth = labels[draft.correct[0]].trim().toLowerCase() === 'true';
    } else if (draft.correct?.length === 1 && labels.length === 0) {
      truth = draft.correct[0] === 0;
    }
    if (truth === null) return problem('A true or false question needs its answer: true or false.');
    options = [
      { label: 'True', isCorrect: truth },
      { label: 'False', isCorrect: !truth },
    ];
  } else if (isObjective) {
    if (labels.length < 2) return problem('A multiple choice question needs at least two options.');
    if (!draft.correct || draft.correct.length === 0) return problem('No answer was given, or it does not match an option.');
    if (type === 'MCQ_SINGLE' && draft.correct.length > 1) {
      return problem('More than one answer for a single answer question. Mark it multi or give one answer.');
    }
    const set = new Set(draft.correct);
    options = labels.map((label, i) => ({ label, isCorrect: set.has(i) }));
  }

  return {
    line: draft.line,
    type,
    prompt,
    options,
    explanation: (draft.explanation ?? '').trim() || null,
    difficulty,
    marks,
    negativeMarks: isObjective ? negative : 0,
    tags: cleanTags(draft.tags),
  };
}

/* CSV ----------------------------------------------------------------------- */

const HEADER_ALIASES: Record<string, string> = {
  question: 'question',
  prompt: 'question',
  text: 'question',
  type: 'type',
  kind: 'type',
  answer: 'answer',
  correct: 'answer',
  key: 'answer',
  explanation: 'explanation',
  rationale: 'explanation',
  difficulty: 'difficulty',
  level: 'difficulty',
  marks: 'marks',
  mark: 'marks',
  points: 'marks',
  negative: 'negative',
  negative_marks: 'negative',
  penalty: 'negative',
  tags: 'tags',
  tag: 'tags',
  topic: 'tags',
  topics: 'tags',
  options: 'options',
  choices: 'options',
};

function headerKey(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (HEADER_ALIASES[h]) return HEADER_ALIASES[h];
  const m = /^(?:option|opt|choice)_?([a-j])$/.exec(h) ?? /^([a-j])$/.exec(h);
  if (m) return `option_${m[1]}`;
  return null;
}

export function parseQuestionCsv(text: string): ImportParse {
  const rows = parseCsv(text);
  const problems: ImportProblem[] = [];
  const questions: ParsedQuestion[] = [];

  if (rows.length === 0) {
    return { format: 'CSV', questions, problems: [{ line: 1, message: 'The file is empty.' }] };
  }

  const header = rows[0].map(headerKey);
  const col = (key: string) => header.indexOf(key);
  if (col('question') < 0) {
    return {
      format: 'CSV',
      questions,
      problems: [{ line: 1, message: 'The header row needs a "question" column.' }],
    };
  }

  const optionCols = 'abcdefghij'
    .split('')
    .map((l) => col(`option_${l}`))
    .filter((i) => i >= 0);

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const get = (key: string) => (col(key) >= 0 ? (row[col(key)] ?? '') : '');

    let labels: string[];
    if (optionCols.length) {
      labels = optionCols.map((c) => row[c] ?? '');
      // Trailing empty option columns are normal; a gap in the middle is not.
      while (labels.length && !labels[labels.length - 1].trim()) labels.pop();
    } else {
      labels = get('options') ? get('options').split('|') : [];
    }

    const trimmed = labels.map((l) => l.trim());
    const correct = get('answer') ? answerIndexes(get('answer'), trimmed) : null;

    const q = finish(
      {
        line,
        prompt: get('question'),
        labels: trimmed,
        correct,
        explicitType: get('type') || null,
        explanation: get('explanation'),
        difficulty: get('difficulty'),
        marks: get('marks'),
        negative: get('negative'),
        tags: get('tags'),
      },
      problems,
    );
    if (q) questions.push(q);
  });

  return { format: 'CSV', questions, problems };
}

/* Plain text ------------------------------------------------------------------ */

const QUESTION_START = /^\s*(?:q(?:uestion)?\s*\.?\s*)?(\d{1,4})\s*[.):\-]\s*(.*)$/i;
const OPTION = /^\s*(\*?)\s*\(?([a-jA-J])\s*[.):\-]\s*(.*)$/;
const FIELD = /^\s*(answer|ans|key|explanation|rationale|tags?|topics?|difficulty|level|marks?|points|negative|penalty|type)\s*[:\-]\s*(.*)$/i;

/**
 * A numbered list, the way a trainer types one.
 *
 *   1. Which vitamin is fat soluble?
 *   a) Vitamin C
 *   *b) Vitamin D          (a star marks the answer, or:)
 *   Answer: B
 *   Explanation: ...
 *   Tags: nutrition, biochemistry
 *
 * A question with no options is a written answer. Two options reading
 * True and False make a true or false question. Lines that belong to
 * nothing are reported rather than silently dropped.
 */
export function parseQuestionText(text: string): ImportParse {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const problems: ImportProblem[] = [];
  const questions: ParsedQuestion[] = [];

  type Draft = {
    line: number;
    prompt: string;
    labels: string[];
    starred: number[];
    answer: string | null;
    fields: Record<string, string>;
    lastField: string | null;
  };
  let draft: Draft | null = null;

  const flush = () => {
    if (!draft) return;
    const correct = draft.starred.length
      ? draft.starred
      : draft.answer !== null
        ? answerIndexes(draft.answer, draft.labels) ??
          (draft.labels.length === 0 && /^(true|false|t|f)$/i.test(draft.answer.trim())
            ? [/^(true|t)$/i.test(draft.answer.trim()) ? 0 : 1]
            : null)
        : null;

    const explicitType =
      draft.fields.type ??
      (draft.labels.length === 0 && draft.answer && /^(true|false|t|f)$/i.test(draft.answer.trim())
        ? 'TRUE_FALSE'
        : null);

    const q = finish(
      {
        line: draft.line,
        prompt: draft.prompt,
        labels: draft.labels,
        correct,
        explicitType,
        explanation: draft.fields.explanation,
        difficulty: draft.fields.difficulty,
        marks: draft.fields.marks,
        negative: draft.fields.negative,
        tags: draft.fields.tags,
      },
      problems,
    );
    if (q) questions.push(q);
    draft = null;
  };

  lines.forEach((raw, i) => {
    const line = i + 1;
    const text = raw.replace(/\t/g, ' ').trimEnd();
    if (!text.trim()) {
      if (draft) draft.lastField = null;
      return;
    }

    const start = QUESTION_START.exec(text);
    // A numbered line inside a question with no options yet is a new
    // question; one after options has started is too. "1." only ever means
    // a question in this format; options are lettered.
    if (start) {
      flush();
      draft = { line, prompt: start[2], labels: [], starred: [], answer: null, fields: {}, lastField: null };
      return;
    }

    if (!draft) {
      problems.push({ line, message: 'This line is outside any question. Questions start with a number, like "1."' });
      return;
    }

    const field = FIELD.exec(text);
    if (field) {
      const name = field[1].toLowerCase();
      const value = field[2].trim();
      if (name === 'answer' || name === 'ans' || name === 'key') {
        draft.answer = value;
        draft.lastField = null;
      } else {
        const key =
          name.startsWith('explanation') || name === 'rationale'
            ? 'explanation'
            : name.startsWith('tag') || name.startsWith('topic')
              ? 'tags'
              : name === 'level'
                ? 'difficulty'
                : name === 'points' || name === 'mark'
                  ? 'marks'
                  : name === 'penalty'
                    ? 'negative'
                    : name;
        draft.fields[key] = value;
        draft.lastField = key === 'explanation' ? key : null;
      }
      return;
    }

    const option = OPTION.exec(text);
    if (option && draft.lastField !== 'explanation') {
      const index = LETTERS.indexOf(option[2].toUpperCase());
      // Options are expected in order; a "c" after "a" means "b" is missing.
      if (index !== draft.labels.length) {
        problems.push({ line, message: `Option ${option[2].toUpperCase()} is out of order; expected ${LETTERS[draft.labels.length]}.` });
      }
      draft.labels.push(option[3].trim());
      if (option[1] === '*') draft.starred.push(draft.labels.length - 1);
      return;
    }

    // Continuation: a wrapped explanation, or a second line of the prompt
    // before any option has appeared.
    if (draft.lastField === 'explanation') {
      draft.fields.explanation = `${draft.fields.explanation ?? ''}\n${text.trim()}`.trim();
    } else if (draft.labels.length === 0 && draft.answer === null) {
      draft.prompt = `${draft.prompt}\n${text.trim()}`.trim();
    } else if (draft.labels.length > 0) {
      // A wrapped option line.
      draft.labels[draft.labels.length - 1] = `${draft.labels[draft.labels.length - 1]} ${text.trim()}`.trim();
    } else {
      problems.push({ line, message: 'Could not tell what this line is.' });
    }
  });

  flush();
  return { format: 'TEXT', questions, problems };
}

/* Detection --------------------------------------------------------------------- */

export function parseQuestions(text: string): ImportParse {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  const looksCsv =
    firstLine.includes(',') &&
    parseCsv(firstLine)[0]?.some((cell) => headerKey(cell) === 'question');
  return looksCsv ? parseQuestionCsv(text) : parseQuestionText(text);
}

/** The CSV a bank exports as, which is also the CSV it imports from. */
export const EXPORT_HEADER = [
  'question',
  'type',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'option_e',
  'option_f',
  'answer',
  'explanation',
  'difficulty',
  'marks',
  'negative',
  'tags',
];

export function exportRow(q: {
  promptHtml: string;
  type: string;
  options: { label: string; isCorrect: boolean }[];
  explanation: string | null;
  difficulty: string;
  marks: number;
  negativeMarks: number;
  tags: string[];
}): string[] {
  const labels = q.options.map((o) => o.label);
  const answer = q.options
    .map((o, i) => (o.isCorrect ? LETTERS[i] : null))
    .filter((l): l is string => Boolean(l))
    .join(',');
  return [
    q.promptHtml,
    q.type.toLowerCase(),
    ...Array.from({ length: 6 }, (_, i) => labels[i] ?? ''),
    answer,
    q.explanation ?? '',
    q.difficulty.toLowerCase(),
    String(q.marks),
    String(q.negativeMarks),
    q.tags.join(', '),
  ];
}
