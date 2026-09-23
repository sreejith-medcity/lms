import type { ExamBlockDef, ExamCriterion, ExamFormat } from '@/lib/exams/types';

/**
 * Marking writing and speaking: the brief the model gets and what is made
 * of its answer. Nothing here calls a model.
 *
 * The criteria are the block's own (the same names and maxima as on the
 * exam's marking sheet), or for a speaking task with one score the
 * format's split of it. The model gives whole or half points per
 * criterion and a short comment to the candidate; the points are clamped
 * to the maxima and summed here, never trusted as a total.
 */

export interface CriterionMark {
  criterion: string;
  points: number;
  comment: string;
}

export interface MarkingResult {
  points: number;
  max: number;
  marks: CriterionMark[];
  overall: string;
  transcript?: string;
}

export function criteriaFor(format: ExamFormat, block: ExamBlockDef): ExamCriterion[] {
  if (block.criteria?.length) return block.criteria;
  return format.speakingCriteria(block.points);
}

export function maxOf(criteria: ExamCriterion[]): number {
  return criteria.reduce((a, c) => a + c.max, 0);
}

/** The instruction, in the exam's language. */
export function markingBrief(format: ExamFormat, criteria: ExamCriterion[]): string {
  const level = format.level ?? format.name;
  if (format.language === 'de') {
    return `Sie bewerten eine telc-Prüfung Deutsch ${level} wie eine erfahrene Prüferin.

So wird bewertet:
${criteria.map((k) => `- ${k.name}: höchstens ${k.max} Punkte.${k.describes ? ' ' + k.describes : ''}`).join('\n')}

Halten Sie sich an das Niveau ${level}. Auf ${level} wird erwartet, was auf
${level} zu erwarten ist, nicht mehr: auf A1 und A2 zählt, ob die Aufgabe
erfüllt und die Mitteilung verständlich ist, und einfache Fehler in
Grammatik und Schreibung sind dort normal und dürfen die Punktzahl nur
dann drücken, wenn sie das Verstehen stören. Auf B1 und B2 wiegen
Zusammenhang, Wortschatz und Richtigkeit schwerer.

Geben Sie zu jedem Kriterium ganze oder halbe Punkte und einen kurzen
Kommentar auf Deutsch, zwei Sätze höchstens, in der Sie-Form und an die
Person gerichtet: was war gut, was fehlt, was wäre der nächste Schritt.
Nennen Sie ein konkretes Beispiel aus dem, was die Person geschrieben
oder gesagt hat. Keine Punktzahl darf über dem Höchstwert liegen und
keine unter null.

"overall" ist eine Rückmeldung von zwei bis drei Sätzen an die Person
selbst, freundlich und brauchbar, ohne die Punkte zu wiederholen.`;
  }
  return `You are marking a ${format.name} practice paper as an experienced examiner would.

The criteria:
${criteria.map((k) => `- ${k.name}: at most ${k.max} points.${k.describes ? ' ' + k.describes : ''}`).join('\n')}

Give whole or half points per criterion and a short comment to the candidate,
two sentences at most, saying what was good, what is missing and what the next
step is, with one concrete example from what they wrote or said. No score may
exceed its maximum or fall below zero.

"overall" is two or three sentences to the candidate, friendly and usable,
without repeating the points.`;
}

export function writingPrompt(format: ExamFormat, criteria: ExamCriterion[], task: string, text: string, length?: string): string {
  const de = format.language === 'de';
  return `${markingBrief(format, criteria)}

${de ? 'Die Aufgabe lautete:' : 'The task was:'}
${task}
${length ? `\n${de ? 'Verlangter Umfang' : 'Length asked for'}: ${length}` : ''}

${de ? 'Das hat die Person geschrieben:' : 'This is what the candidate wrote:'}
---
${text.slice(0, 12000)}
---`;
}

export function speakingPrompt(format: ExamFormat, criteria: ExamCriterion[], task: string, seconds?: number | null): string {
  const de = format.language === 'de';
  return `${markingBrief(format, criteria)}

${de ? 'Die Aufgabe lautete:' : 'The task was:'}
${task}
${seconds ? `\n${de ? `Die Aufnahme dauert etwa ${Math.round(seconds)} Sekunden.` : `The recording is about ${Math.round(seconds)} seconds long.`}` : ''}

${
  de
    ? `Hören Sie die Aufnahme. Schreiben Sie zuerst in "transcript", was die
Person gesagt hat, so wie sie es gesagt hat. Bewerten Sie dann. Achten
Sie auch auf Aussprache und Flüssigkeit, die hört man nur hier. Ist auf
der Aufnahme nichts zu verstehen oder nichts zu hören, geben Sie null
Punkte und sagen Sie das im Kommentar.`
    : `Listen to the recording. First write in "transcript" what the candidate
said, as they said it. Then mark. Attend to pronunciation and fluency, which
only the recording shows. If nothing can be heard or understood, give zero
and say so in the comment.`
}`;
}

/** The JSON the model must answer with. */
export function markingSchema(withTranscript: boolean) {
  return {
    type: 'OBJECT',
    properties: {
      marks: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { criterion: { type: 'STRING' }, points: { type: 'NUMBER' }, comment: { type: 'STRING' } },
          required: ['criterion', 'points', 'comment'],
        },
      },
      overall: { type: 'STRING' },
      ...(withTranscript ? { transcript: { type: 'STRING' } } : {}),
    },
    required: ['marks', 'overall', ...(withTranscript ? ['transcript'] : [])],
  };
}

const clamp = (n: unknown, max: number) => {
  const half = Math.round((Number(n) || 0) * 2) / 2;
  return Math.max(0, Math.min(max, half));
};

/** Match the model's marks to the criteria by name, not by order; clamp; sum. */
export function parseMarking(raw: Record<string, unknown>, criteria: ExamCriterion[], withTranscript: boolean): MarkingResult {
  const given = Array.isArray(raw.marks) ? (raw.marks as Record<string, unknown>[]) : [];
  const marks: CriterionMark[] = criteria.map((k) => {
    const name = k.name.toLowerCase().trim();
    const hit =
      given.find((g) => String(g.criterion ?? '').toLowerCase().trim() === name) ??
      given.find((g) => String(g.criterion ?? '').toLowerCase().includes(name.slice(0, 8)));
    return { criterion: k.name, points: clamp(hit?.points, k.max), comment: String(hit?.comment ?? '').slice(0, 600) };
  });
  const max = maxOf(criteria);
  return {
    points: Math.min(max, marks.reduce((a, m) => a + m.points, 0)),
    max,
    marks,
    overall: String(raw.overall ?? '').slice(0, 1200),
    ...(withTranscript ? { transcript: String(raw.transcript ?? '').slice(0, 8000) } : {}),
  };
}

/** The task text the marker is shown for a writing or speaking block, from the drawn content. */
export function taskTextOf(block: Record<string, unknown>, themeIndex?: number | null): string {
  const strip = (s: unknown) =>
    String(s ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const themes = block.themen as Record<string, unknown>[] | undefined;
  const theme = themes && themeIndex != null ? themes[themeIndex] : null;
  const src = theme ?? block;
  const parts: string[] = [];
  if (src.titel) parts.push(strip(src.titel));
  if (src.brief) parts.push(strip(src.brief));
  if (src.auftrag) parts.push(strip(src.auftrag));
  const lead = src.leit as { k: string; t: string }[] | undefined;
  if (lead?.length) parts.push(lead.map((l) => `${l.k}) ${strip(l.t)}`).join('\n'));
  const card = src.karte as string[] | undefined;
  if (card?.length) parts.push(card.map((c) => `- ${strip(c)}`).join('\n'));
  return parts.join('\n\n');
}
