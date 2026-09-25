import type { ExamFormat } from '@/lib/exams/types';

/**
 * What the public test pages say, in English. The exam's own wording (the
 * German of a telc paper) stays inside the paper; the page that sells it
 * speaks to the person choosing it.
 */

export const FAMILY_BLURB: Record<string, string> = {
  telc: 'Full German mock exams in the telc format, from A1 to B2: every part of the real paper, on the clock, marked the way the examiners mark.',
  ielts: 'IELTS Academic and General Training mock tests with band scores.',
  oet: 'OET mock tests for nurses, in the format of the real test.',
  pte: 'PTE Academic mock tests with scores on the official scale.',
  nclex: 'NCLEX-RN practice that adapts to you, the way the real test does.',
  dha: 'Timed DHA practice exams for healthcare professionals.',
};

const WHO: Record<string, string> = {
  TELC_A1: 'For beginners: introducing yourself, everyday forms, short notices and simple conversations. Often asked for a family reunion visa.',
  TELC_A2: 'For everyday German: shopping, work, appointments, short letters and conversations on familiar topics.',
  TELC_B1: 'For independent German at work, in training and with the authorities. The level most asked for by employers and for Ausbildung.',
  TELC_B2: 'For confident German at work and in study: arguing a point, formal letters, longer texts. Asked for by nursing recognition and universities.',
};

export function whoFor(format: ExamFormat): string {
  return WHO[format.code] ?? format.who;
}

export function passRule(format: ExamFormat): string {
  const s = format.scoring;
  const parts = s.groups.filter((g) => g.min != null).map((g) => `${g.min} of ${g.max} in the ${g.moduleIds.includes('ma') && g.moduleIds.length === 1 ? 'spoken' : 'written'} part`);
  return `Pass mark ${s.pass} of ${s.total}${parts.length ? `, with at least ${parts.join(' and ')}` : ''}.`;
}

export function minutesOf(format: ExamFormat): number {
  return format.sections.reduce((a, x) => a + x.minutes + (x.preparationMinutes ?? 0), 0);
}

export const WHAT_YOU_GET = [
  'The whole paper: reading, language, listening with recordings, writing and speaking, in the order and times of the exam.',
  'A fresh paper every time, drawn from the full bank, so a second attempt is not a memory test.',
  'Objective parts counted at once, with the right answer and why for every question.',
  'Writing and speaking marked against the exam\'s own criteria, with a comment on each and a model answer.',
  'Exam mode on the clock, or practice mode with no clock and free movement between parts.',
];

const MODULE_GLOSS: Record<string, string> = {
  Hören: 'Listening',
  Hörverstehen: 'Listening',
  Lesen: 'Reading',
  Leseverstehen: 'Reading',
  Sprachbausteine: 'Language elements',
  Schreiben: 'Writing',
  'Schriftlicher Ausdruck': 'Writing',
  Sprechen: 'Speaking',
  'Mündlicher Ausdruck': 'Speaking',
};

export interface ModuleRow {
  name: string;
  own: string;
  parts: number;
  items: number;
  minutes: string;
  points: number;
}

/** The paper as a table: each part in English (with the exam's own name), its tasks, time and points. */
export function moduleRows(format: ExamFormat): ModuleRow[] {
  return format.scoring.modules.map((m) => {
    const blocks = format.blocks.filter((b) => b.moduleId === m.id);
    const sectionIds = [...new Set(blocks.map((b) => b.sectionId))];
    const sections = format.sections.filter((x) => sectionIds.includes(x.id));
    const shared = sections.some((x) => format.blocks.some((b) => b.sectionId === x.id && b.moduleId !== m.id));
    const firstOwner = shared ? format.blocks.find((b) => b.sectionId === sections[0]?.id)?.moduleId : m.id;
    const mins = sections.reduce((a, x) => a + x.minutes, 0);
    const prep = sections.reduce((a, x) => a + (x.preparationMinutes ?? 0), 0);
    return {
      name: MODULE_GLOSS[m.name] ?? m.name,
      own: m.name,
      parts: blocks.length,
      items: blocks.reduce((a, b) => a + (b.count ?? 0), 0),
      minutes: shared && firstOwner !== m.id ? 'shared, above' : `${mins} min${prep ? ` + ${prep} to prepare` : ''}${shared ? ' (shared)' : ''}`,
      points: m.max,
    };
  });
}
