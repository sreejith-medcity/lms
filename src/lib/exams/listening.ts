/**
 * How a listening block is cut into pieces, the same rule the telc
 * simulator cut its recordings by (lib/audio-parts.ts there).
 *
 * The exam does not play one long recording: it reads the instruction,
 * gives a reading time with a countdown, plays the first text, pauses,
 * plays the next. So lines at the start and end whose speaker is exactly
 * "Ansage" are the instruction (and "Ende von Teil eins"); in between, an
 * "Ansage" line starts a new text when that yields exactly as many texts
 * as the block has; otherwise the lines are divided evenly. "Exactly"
 * matters: a speaker called "Ansage 1" is a text being read out.
 */

export type ScriptLine = { sp: string; t: string };

export interface ListeningPart {
  /** 0 for the spoken instruction, then the texts. */
  index: number;
  kind: 'instruction' | 'text';
  lines: ScriptLine[];
}

const isAnnouncement = (sp: unknown) => /^ansage$/i.test(String(sp ?? '').trim());

export function cutsOf(script: ScriptLine[], texts: number): { head: number; tail: number; cuts: number[] } {
  let head = 0;
  while (head < script.length && isAnnouncement(script[head].sp)) head++;
  let tail = script.length;
  while (tail > head && isAnnouncement(script[tail - 1].sp)) tail--;
  const marks: number[] = [];
  for (let i = head + 1; i < tail; i++) if (isAnnouncement(script[i].sp)) marks.push(i);
  if (marks.length && marks.length + 1 === texts) return { head, tail, cuts: marks };
  const rest = tail - head;
  if (texts >= 2 && rest >= texts && rest % texts === 0) {
    const each = rest / texts;
    const cuts: number[] = [];
    for (let k = 1; k < texts; k++) cuts.push(head + k * each);
    return { head, tail, cuts };
  }
  return { head, tail, cuts: [] };
}

/** The pieces in playing order: the instruction when there is one, then each text (the closing line rides with the last). */
export function listeningParts(script: ScriptLine[] | undefined, texts: number | undefined): ListeningPart[] {
  const lines = Array.isArray(script) ? script.filter((l) => l && typeof l.t === 'string') : [];
  if (!lines.length) return [];
  const { head, cuts } = cutsOf(lines, Number(texts) || 1);
  const out: ListeningPart[] = [];
  if (head > 0) out.push({ index: 0, kind: 'instruction', lines: lines.slice(0, head) });
  const bounds = [head, ...cuts, lines.length];
  for (let i = 0; i < bounds.length - 1; i++) {
    const piece = lines.slice(bounds[i], bounds[i + 1]);
    if (piece.length) out.push({ index: out.length, kind: 'text', lines: piece });
  }
  return out;
}
