import type { ExamBlockDef, ExamCriterion, ExamFormat, ExamScoring, ExamSection } from '@/lib/exams/types';
import content from './telc-content';

/**
 * The four telc German exams: A1 (Start Deutsch 1), A2, B1 (Zertifikat
 * Deutsch) and B2, in the structure of the official practice papers. The
 * texts the candidate reads (section introductions, block instructions,
 * the marking criteria, B2's seven fixed speaking themes) are in
 * telc-content.json, carried over from the telc simulator's exam source;
 * they are the exam's own wording and stay in German.
 *
 * A1 and A2 are marked out of 60 with 36 to pass. B1 and B2 are marked out
 * of 300 with 180 to pass, and two conditions besides: at least 135 of 225
 * in the written part and 45 of 75 in the spoken part.
 */

type Level = 'A1' | 'A2' | 'B1' | 'B2';

interface LevelContent {
  name: string;
  subtitle: string;
  who: string;
  timeLine: string;
  lede: string;
  rules: string[];
  passNote: string;
  rows: string[][];
  sections: ExamSection[];
  blocks: ExamBlockDef[];
  scoring: ExamScoring;
}

const LEVELS = content as unknown as Record<Level, LevelContent>;

/**
 * A speaking task has one score, not a criteria list. So that the same
 * marking applies, it gets the criteria telc marks speech on, shared out
 * over its points: 40 % task, 30 % pronunciation and fluency, the rest
 * vocabulary and accuracy, in half points.
 */
export function telcSpeakingCriteria(max: number): ExamCriterion[] {
  const share = (part: number) => Math.round(max * part * 2) / 2;
  const a = share(0.4);
  const b = share(0.3);
  return [
    { name: 'Aufgabenbewältigung', max: a, describes: 'Wurde die Aufgabe erfüllt, alles Verlangte gesagt?' },
    { name: 'Aussprache und Flüssigkeit', max: b, describes: 'Verständlich gesprochen, ohne lange Stockungen?' },
    { name: 'Wortschatz und Korrektheit', max: Math.max(0, max - a - b), describes: 'Reicht der Wortschatz, stören Fehler das Verstehen?' },
  ];
}

function telc(level: Level): ExamFormat {
  const c = LEVELS[level];
  return {
    code: `TELC_${level}`,
    family: 'telc',
    level,
    name: c.name,
    subtitle: c.subtitle,
    language: 'de',
    slug: `${level.toLowerCase()}-telc-mocktest`,
    who: c.who,
    timeLine: c.timeLine,
    lede: c.lede,
    rules: c.rules,
    passNote: c.passNote,
    rows: c.rows as [string, string, string, string][],
    sections: c.sections,
    blocks: c.blocks,
    scoring: c.scoring,
    speakingCriteria: telcSpeakingCriteria,
    wording: level === 'A1' || level === 'A2' ? 'simple' : 'standard',
  };
}

export const TELC_A1 = telc('A1');
export const TELC_A2 = telc('A2');
export const TELC_B1 = telc('B1');
export const TELC_B2 = telc('B2');

export const TELC_FORMATS: ExamFormat[] = [TELC_A1, TELC_A2, TELC_B1, TELC_B2];
