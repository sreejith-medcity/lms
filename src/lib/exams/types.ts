/**
 * The test portal's formats.
 *
 * A format is the product's knowledge of one real exam: which sections it
 * has and how long each runs, which blocks sit in each section and what
 * each is worth, how the listening is played, how writing and speaking are
 * marked, and what it takes to pass. It is code (src/lib/exams/formats),
 * changed with a deploy; the content that fills the blocks (sets of
 * variants, per academy) is data. Nothing in here calls a database or a
 * model; the engine, the draw, the scoring and the pages read these.
 */

/** The block layouts the player can draw and the marker can score. */
export type ExamLayout =
  /* Reading: five texts to ten headings, each heading once. */
  | 'match'
  /* Reading: a long text and choice questions a, b, c. */
  | 'mc'
  /* Reading: situations to adverts, each advert once, "x" when none fits. */
  | 'ads'
  /* Reading, A1: a situation and two adverts, a or b. */
  | 'adsAB'
  /* Reading: statements about short texts or signs, true or false. */
  | 'textRF'
  /* Reading, A2: a signboard and where-to-go questions. */
  | 'infoMC'
  /* Language: a text with gaps, three options each. */
  | 'cloze3'
  /* Language: a text with gaps and a word list, each word once. */
  | 'clozeBank'
  /* Listening: statements, true or false. */
  | 'audioRF'
  /* Listening: choice questions. */
  | 'audioMC'
  /* Listening, A2: a note with gaps, a word or a number typed in. */
  | 'audioNotiz'
  /* Listening, A2: conversations to statements from a list. */
  | 'audioMatch'
  /* Writing, A1/A2: a form filled in from a text, a word per field. */
  | 'formular'
  /* Writing, A1/A2: a short message to lead points. */
  | 'mitteilung'
  /* Writing, B1/B2: a letter or e-mail to lead points, a choice of themes on B2. */
  | 'write'
  /* Speaking: a task card, preparation, then a recording. */
  | 'speak';

/** Layouts the server scores from the key; the rest are marked. */
export const AUTO_LAYOUTS: readonly ExamLayout[] = [
  'match', 'mc', 'ads', 'adsAB', 'textRF', 'infoMC', 'cloze3', 'clozeBank', 'audioRF', 'audioMC', 'audioNotiz', 'audioMatch', 'formular',
];
/** Layouts answered by typing rather than choosing, compared loosely. */
export const TYPED_LAYOUTS: readonly ExamLayout[] = ['audioNotiz', 'formular'];
export const WRITING_LAYOUTS: readonly ExamLayout[] = ['mitteilung', 'write'];
export const LISTENING_LAYOUTS: readonly ExamLayout[] = ['audioRF', 'audioMC', 'audioNotiz', 'audioMatch'];

export interface ExamCriterion {
  /** The name on the marking sheet, as the examiner would say it. */
  name: string;
  describes?: string;
  max: number;
}

export interface ExamSection {
  id: string;
  /** Shown in the navigation and on the result. */
  label: string;
  short: string;
  title: string;
  /** The section's own clock, in exam mode. */
  minutes: number;
  /** Preparation time before a speaking section, in minutes; the same tasks, notes allowed, no recording. */
  preparationMinutes?: number;
  /** What the candidate is told at the start, in the exam's language; plain and simple versions. */
  intro: string;
  plain: string;
  notice: string;
}

export interface ExamBlockDef {
  id: string;
  sectionId: string;
  /** The module the block scores into (lv, sb, hv, sa, ma). */
  moduleId: string;
  /** "Teil 1", shown as the block's heading with the title. */
  part: string;
  title: string;
  layout: ExamLayout;
  instructions: string;
  plain: string;
  /** Points per item for auto-marked blocks; the block's total for marked ones. */
  points: number;
  /** Items in an auto-marked block. */
  count?: number;
  /** Item numbers restart per group (A1/A2 number per module); undefined numbers through the paper. */
  numberGroup?: string;
  /** Listening: how many texts, how long to read before the first, the pause between, plays allowed. */
  textCount?: number;
  readSeconds?: number;
  pauseSeconds?: number;
  plays?: number;
  /** Marked blocks: the criteria and maxima on the marking sheet. */
  criteria?: ExamCriterion[];
  /** Writing: the length asked for, and on A2 how many of the lead points to pick. */
  words?: { min: number; max: number };
  choose?: number;
  fieldLabel?: string;
  /** B2 letter: one of the two themes must be of this kind (a complaint). */
  guaranteed?: string;
  /** Speaking: preparation and recording seconds per task, and the kind of task. */
  prepSeconds?: number;
  recordSeconds?: number;
  speakingKind?: string;
  /** B2 speaking part 1: the fixed themes, set by the exam, chosen from a list. */
  themes?: SpeakingTheme[];
}

export interface SpeakingTheme {
  title: string;
  short: string;
  task: string;
  card: string[];
  phrases: string[];
  keywords?: string[][];
}

export interface ExamModule {
  id: string;
  name: string;
  max: number;
  /** auto: counted from the key; marked: writing or speaking. */
  source: 'auto' | 'marked';
}

export interface ExamScoring {
  total: number;
  pass: number;
  modules: ExamModule[];
  /** Extra conditions: a group of modules that must reach a minimum together. */
  groups: { name: string; moduleIds: string[]; max: number; min?: number }[];
}

export interface ExamFormat {
  code: string;
  /** telc, ielts, oet, pte, nclex, dha: what an allowance is granted for. */
  family: string;
  level: string | null;
  name: string;
  subtitle: string;
  /** The language the candidate reads and answers in. */
  language: 'de' | 'en';
  /** The public page's address under /tests. */
  slug: string;
  who: string;
  timeLine: string;
  lede: string;
  rules: string[];
  passNote: string;
  /** The format table on the public page: module, parts, time, points. */
  rows: [string, string, string, string][];
  sections: ExamSection[];
  blocks: ExamBlockDef[];
  scoring: ExamScoring;
  /** Speaking criteria as shares of a task's points when the block has none of its own. */
  speakingCriteria: (max: number) => ExamCriterion[];
  /** Texts around the exam: simple wording for beginners' levels. */
  wording: 'standard' | 'simple';
}

export function moduleOf(format: ExamFormat, blockId: string): string {
  const b = format.blocks.find((x) => x.id === blockId);
  return b?.moduleId ?? blockId.replace(/\d+$/, '');
}

export function blocksIn(format: ExamFormat, sectionId: string): ExamBlockDef[] {
  return format.blocks.filter((b) => b.sectionId === sectionId);
}

export function isAuto(layout: ExamLayout): boolean {
  return AUTO_LAYOUTS.includes(layout);
}

export function isTyped(layout: ExamLayout): boolean {
  return TYPED_LAYOUTS.includes(layout);
}
