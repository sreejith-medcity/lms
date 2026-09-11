/**
 * The examiner's brief, and what it hands back.
 *
 * Every exam this academy teaches marks writing and speaking against a
 * published rubric, and the point of an AI examiner is not to be clever
 * but to apply that rubric the same way every time, in the exam's own
 * words and on the exam's own scale. So the presets below say what the
 * criteria are, what the scale is, and what a pass looks like; the prompt
 * is built from them; and the answer that comes back is checked field by
 * field before anything is stored. Nothing here calls a model.
 */

export type PracticeKind = 'WRITING' | 'SPEAKING';

export interface ExamPreset {
  key: string;
  kind: PracticeKind;
  label: string;
  /** What the learner is told this practises. */
  blurb: string;
  scale: { min: number; max: number; step: number; name: string };
  criteria: { key: string; name: string; describes: string }[];
  /** Target word count or speaking time, for the task generator and the marker. */
  length: string;
  /** Language of the answer. */
  language: 'en' | 'de';
  /** What counts as a pass on this scale, for the tick on the result. */
  pass: number;
}

export const EXAM_PRESETS: ExamPreset[] = [
  {
    key: 'IELTS_TASK2',
    kind: 'WRITING',
    label: 'IELTS Writing Task 2',
    blurb: 'A 250-word essay on a given position, marked to the public band descriptors.',
    scale: { min: 0, max: 9, step: 0.5, name: 'Band' },
    criteria: [
      { key: 'TR', name: 'Task response', describes: 'Addresses all parts of the task with a clear position, developed and supported ideas.' },
      { key: 'CC', name: 'Coherence and cohesion', describes: 'Logical organisation, paragraphing, and cohesive devices used naturally.' },
      { key: 'LR', name: 'Lexical resource', describes: 'Range and precision of vocabulary, collocation, spelling.' },
      { key: 'GRA', name: 'Grammatical range and accuracy', describes: 'Variety of structures and how many are error-free.' },
    ],
    length: 'at least 250 words',
    language: 'en',
    pass: 7,
  },
  {
    key: 'IELTS_TASK1',
    kind: 'WRITING',
    label: 'IELTS Writing Task 1 (Academic)',
    blurb: 'A 150-word report on a chart, table or process.',
    scale: { min: 0, max: 9, step: 0.5, name: 'Band' },
    criteria: [
      { key: 'TA', name: 'Task achievement', describes: 'Overview, key features selected and compared, data accurate.' },
      { key: 'CC', name: 'Coherence and cohesion', describes: 'Logical organisation and cohesive devices.' },
      { key: 'LR', name: 'Lexical resource', describes: 'Range and precision of vocabulary for describing data.' },
      { key: 'GRA', name: 'Grammatical range and accuracy', describes: 'Variety and accuracy of structures.' },
    ],
    length: 'at least 150 words',
    language: 'en',
    pass: 7,
  },
  {
    key: 'OET_LETTER',
    kind: 'WRITING',
    label: 'OET Writing (letter)',
    blurb: 'A referral or discharge letter from case notes, marked to the OET writing criteria.',
    scale: { min: 0, max: 500, step: 10, name: 'Score' },
    criteria: [
      { key: 'PURPOSE', name: 'Purpose', describes: 'The purpose of the letter is clear early and expanded appropriately.' },
      { key: 'CONTENT', name: 'Content', describes: 'Relevant case notes included, irrelevant ones left out, nothing invented.' },
      { key: 'CONCISENESS', name: 'Conciseness and clarity', describes: 'No padding; the reader gets what they need quickly.' },
      { key: 'GENRE', name: 'Genre and style', describes: 'Register, tone and format suit the reader and the letter type.' },
      { key: 'ORGANISATION', name: 'Organisation and layout', describes: 'Paragraphing and sequencing help the reader.' },
      { key: 'LANGUAGE', name: 'Language', describes: 'Grammar, vocabulary, spelling and punctuation.' },
    ],
    length: '180 to 200 words',
    language: 'en',
    pass: 350,
  },
  {
    key: 'PTE_ESSAY',
    kind: 'WRITING',
    label: 'PTE Write Essay',
    blurb: 'A 200 to 300 word essay in 20 minutes.',
    scale: { min: 10, max: 90, step: 1, name: 'Score' },
    criteria: [
      { key: 'CONTENT', name: 'Content', describes: 'Addresses the prompt fully with relevant supporting points.' },
      { key: 'FORM', name: 'Form', describes: 'Within 200 to 300 words, paragraphs, no bullet points.' },
      { key: 'DSC', name: 'Development, structure and coherence', describes: 'Logical development and clear structure.' },
      { key: 'GRAMMAR', name: 'Grammar', describes: 'Accuracy and range.' },
      { key: 'VOCAB', name: 'General linguistic range and vocabulary', describes: 'Precision and range of vocabulary.' },
      { key: 'SPELLING', name: 'Spelling', describes: 'Consistent, correct spelling in one variety of English.' },
    ],
    length: '200 to 300 words',
    language: 'en',
    pass: 65,
  },
  {
    key: 'GERMAN_B1_WRITING',
    kind: 'WRITING',
    label: 'German B1 Schreiben (telc / Goethe)',
    blurb: 'A semi-formal or informal letter or email at B1, marked to the telc B1 writing criteria.',
    scale: { min: 0, max: 45, step: 1, name: 'Punkte' },
    criteria: [
      { key: 'INHALT', name: 'Inhalt (content)', describes: 'All Leitpunkte addressed appropriately and fully.' },
      { key: 'AUSDRUCK', name: 'Kommunikative Gestaltung', describes: 'Register, structure, connectors, addressing the reader.' },
      { key: 'KORREKTHEIT', name: 'Formale Richtigkeit', describes: 'Grammar, word order, spelling and punctuation at B1.' },
    ],
    length: 'about 80 to 100 words',
    language: 'de',
    pass: 27,
  },
  {
    key: 'GERMAN_B2_WRITING',
    kind: 'WRITING',
    label: 'German B2 Schreiben',
    blurb: 'A formal letter, complaint or opinion text at B2.',
    scale: { min: 0, max: 45, step: 1, name: 'Punkte' },
    criteria: [
      { key: 'INHALT', name: 'Inhalt', describes: 'All Leitpunkte handled with detail and argument.' },
      { key: 'AUSDRUCK', name: 'Ausdruck und Textaufbau', describes: 'Range, precision, cohesion and register at B2.' },
      { key: 'KORREKTHEIT', name: 'Formale Richtigkeit', describes: 'Grammar and spelling largely error-free at B2.' },
    ],
    length: 'about 150 words',
    language: 'de',
    pass: 27,
  },
  {
    key: 'IELTS_SPEAKING',
    kind: 'SPEAKING',
    label: 'IELTS Speaking (Part 2 and 3)',
    blurb: 'Speak for one to two minutes on a cue card, then answer follow-up questions.',
    scale: { min: 0, max: 9, step: 0.5, name: 'Band' },
    criteria: [
      { key: 'FC', name: 'Fluency and coherence', describes: 'Speaking at length without noticeable effort, ideas linked.' },
      { key: 'LR', name: 'Lexical resource', describes: 'Range of vocabulary, paraphrase, idiomatic language.' },
      { key: 'GRA', name: 'Grammatical range and accuracy', describes: 'Range of structures and accuracy.' },
      { key: 'PRON', name: 'Pronunciation', describes: 'Judged only where the transcript shows it: cannot be assessed from text alone, so this is estimated from clarity of the transcription and said so.' },
    ],
    length: 'one to two minutes',
    language: 'en',
    pass: 7,
  },
  {
    key: 'OET_SPEAKING',
    kind: 'SPEAKING',
    label: 'OET Speaking (role play)',
    blurb: 'A five-minute clinician and patient role play from a card.',
    scale: { min: 0, max: 500, step: 10, name: 'Score' },
    criteria: [
      { key: 'INTELLIGIBILITY', name: 'Intelligibility', describes: 'Estimated from the transcript only.' },
      { key: 'FLUENCY', name: 'Fluency', describes: 'Rate and continuity.' },
      { key: 'APPROPRIATENESS', name: 'Appropriateness of language', describes: 'Register and plain language for a patient.' },
      { key: 'RESOURCES', name: 'Resources of grammar and expression', describes: 'Range and accuracy.' },
      { key: 'CLINICAL', name: 'Clinical communication', describes: 'Relationship building, understanding the patient, structure, information giving.' },
    ],
    length: 'about five minutes',
    language: 'en',
    pass: 350,
  },
  {
    key: 'GERMAN_B1_SPEAKING',
    kind: 'SPEAKING',
    label: 'German B1 Sprechen',
    blurb: 'Sich vorstellen, ein Thema präsentieren, gemeinsam etwas planen.',
    scale: { min: 0, max: 75, step: 1, name: 'Punkte' },
    criteria: [
      { key: 'AUSDRUCK', name: 'Ausdrucksfähigkeit', describes: 'Range and appropriateness of language at B1.' },
      { key: 'AUFGABE', name: 'Aufgabenbewältigung', describes: 'Task handled fully, interaction maintained.' },
      { key: 'KORREKTHEIT', name: 'Formale Richtigkeit', describes: 'Grammar and word order.' },
      { key: 'AUSSPRACHE', name: 'Aussprache und Intonation', describes: 'Estimated from the transcript only, and said so.' },
    ],
    length: 'about three minutes',
    language: 'de',
    pass: 45,
  },
];

export function presetFor(key: string): ExamPreset | null {
  return EXAM_PRESETS.find((p) => p.key === key) ?? null;
}

/* Prompts ------------------------------------------------------------------ */

const RESPONSE_SHAPE = `Return ONLY a JSON object with exactly these keys:
{
  "overall": <number on the scale>,
  "criteria": [{ "key": "<criterion key>", "score": <number on the scale>, "comment": "<one or two sentences>" }],
  "strengths": ["<short point>", ...],
  "improvements": ["<short, specific, actionable point>", ...],
  "corrections": [{ "original": "<a phrase from the answer>", "better": "<the corrected phrase>", "why": "<a few words>" }],
  "summary": "<two or three sentences the learner will read first>"
}
No markdown, no prose outside the JSON.`;

/** The examiner's standing instructions, per exam. */
export function evaluationSystemPrompt(preset: ExamPreset): string {
  const lang = preset.language === 'de' ? 'German' : 'English';
  return [
    `You are an experienced ${preset.label} examiner at a coaching institute. You mark strictly to the official criteria, the way a real examiner would on exam day, and you never inflate a mark to be kind: a learner who is told band 7 and gets 5.5 on the day has been harmed, not helped.`,
    `The answer is in ${lang}. Write your comments in English, quoting the learner's ${lang} where useful.`,
    `Scale: ${preset.scale.name} from ${preset.scale.min} to ${preset.scale.max} in steps of ${preset.scale.step}. Give the overall and each criterion on that scale.`,
    `Criteria:`,
    ...preset.criteria.map((c) => `- ${c.key}: ${c.name}. ${c.describes}`),
    preset.kind === 'SPEAKING'
      ? `You are marking a transcript of speech, not audio. Where a criterion needs the sound (pronunciation, intonation), estimate cautiously from the transcript and say in the comment that it is an estimate.`
      : `Expected length: ${preset.length}. An answer well under length is penalised as the exam would penalise it.`,
    `Be concrete. Every improvement must name what to change and give an example. Corrections quote the learner's own words.`,
    RESPONSE_SHAPE,
  ].join('\n');
}

export function evaluationUserPrompt(input: { task: string; answer: string; wordCount: number; durationSeconds?: number | null }): string {
  return [
    `TASK:`,
    input.task.trim(),
    ``,
    `LEARNER'S ANSWER (${input.wordCount} words${input.durationSeconds ? `, ${Math.round(input.durationSeconds)} seconds of speech` : ''}):`,
    input.answer.trim(),
  ].join('\n');
}

/** Asking for a fresh task of the right kind. */
export function taskSystemPrompt(preset: ExamPreset): string {
  const lang = preset.language === 'de' ? 'German' : 'English';
  return [
    `You write practice tasks for ${preset.label}, in the style and difficulty of the real exam. The task is written in ${lang}.`,
    preset.kind === 'SPEAKING'
      ? `Produce one speaking task: a cue card or role-play card with bullet points, plus two follow-up questions. Vary the topic; avoid the most clichéd ones.`
      : `Produce one writing task exactly as the exam would word it, including the situation, the required length (${preset.length}) and any bullet points the exam gives. Vary the topic; avoid the most clichéd ones.`,
    `Return ONLY a JSON object: { "title": "<short title>", "task": "<the full task text>" }. No markdown.`,
  ].join('\n');
}

/* Parsing ------------------------------------------------------------------ */

export interface Evaluation {
  overall: number;
  criteria: { key: string; name: string; score: number; comment: string }[];
  strengths: string[];
  improvements: string[];
  corrections: { original: string; better: string; why: string }[];
  summary: string;
}

/** The model's reply, checked and clamped to the exam's scale. */
export function parseEvaluation(raw: string, preset: ExamPreset): { ok: true; evaluation: Evaluation } | { ok: false; error: string } {
  const json = extractJson(raw);
  if (!json) return { ok: false, error: 'The examiner did not answer in the expected shape.' };

  const clamp = (n: unknown): number | null => {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    const snapped = Math.round(v / preset.scale.step) * preset.scale.step;
    return Math.min(preset.scale.max, Math.max(preset.scale.min, Number(snapped.toFixed(2))));
  };

  const overall = clamp(json.overall);
  if (overall === null) return { ok: false, error: 'No overall mark came back.' };

  const rows = Array.isArray(json.criteria) ? (json.criteria as Record<string, unknown>[]) : [];
  const criteria = preset.criteria.map((c) => {
    const row = rows.find((r) => String(r.key).toUpperCase() === c.key);
    return {
      key: c.key,
      name: c.name,
      score: (row ? clamp(row.score) : null) ?? overall,
      comment: row && typeof row.comment === 'string' ? row.comment.slice(0, 600) : '',
    };
  });

  const strings = (v: unknown, max: number) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 300)).slice(0, max) : [];

  const corrections = Array.isArray(json.corrections)
    ? (json.corrections as Record<string, unknown>[])
        .filter((c) => c && typeof c.original === 'string' && typeof c.better === 'string')
        .map((c) => ({ original: String(c.original).slice(0, 200), better: String(c.better).slice(0, 200), why: typeof c.why === 'string' ? c.why.slice(0, 200) : '' }))
        .slice(0, 12)
    : [];

  return {
    ok: true,
    evaluation: {
      overall,
      criteria,
      strengths: strings(json.strengths, 6),
      improvements: strings(json.improvements, 8),
      corrections,
      summary: typeof json.summary === 'string' ? json.summary.slice(0, 800) : '',
    },
  };
}

export function parseTask(raw: string): { title: string; task: string } | null {
  const json = extractJson(raw);
  if (!json || typeof json.task !== 'string' || !json.task.trim()) return null;
  return { title: typeof json.title === 'string' ? json.title.slice(0, 120) : 'Practice task', task: json.task.trim().slice(0, 4000) };
}

/** The first JSON object in a reply, whatever the model wrapped it in. */
export function extractJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** A mark against the exam's pass line. */
export function isPass(preset: ExamPreset, overall: number): boolean {
  return overall >= preset.pass;
}

/** "Band 6.5", "350 of 500", "38 of 45 Punkte": the mark the way the exam says it. */
export function scoreLabel(preset: ExamPreset, overall: number): string {
  const n = Number.isInteger(overall) ? String(overall) : overall.toFixed(1);
  if (preset.scale.name === 'Band') return `Band ${n}`;
  if (preset.scale.name === 'Punkte') return `${n} of ${preset.scale.max} Punkte`;
  return `${n} of ${preset.scale.max}`;
}

/**
 * A rubric-marked assessment answer maps the exam scale onto the question's
 * marks: band 6.5 of 9 on a 10-mark question is 7.2 marks.
 */
export function marksFromScale(preset: ExamPreset, overall: number, marks: number): number {
  const range = preset.scale.max - preset.scale.min;
  if (range <= 0) return 0;
  return Math.round(((overall - preset.scale.min) / range) * marks * 100) / 100;
}
