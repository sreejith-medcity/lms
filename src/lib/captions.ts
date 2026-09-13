/**
 * Captions and transcripts: the text with no database in it.
 *
 * A transcript is a list of timed segments. It arrives as WebVTT or SRT
 * (uploaded, or written by the video platform), is kept as segments, and
 * goes out again as WebVTT for the player's <track>. The same segments
 * drive the transcript tab, the search inside a course and, later, the
 * tutor.
 */

export interface Segment {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

/** "01:02:03.456", "02:03.456", "01:02:03,456" (SRT) → seconds. */
export function parseTimestamp(raw: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(raw.trim());
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const s = Number(m[3]);
  const ms = Number(m[4].padEnd(3, '0'));
  return h * 3600 + min * 60 + s + ms / 1000;
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

/** Strip the markup a caption line may carry: <v Speaker>, <i>, <c.class>, &nbsp;. */
function cleanLine(line: string): { text: string; speaker?: string } {
  let speaker: string | undefined;
  const v = /^<v(?:\.[^\s>]+)?\s+([^>]+)>/.exec(line);
  if (v) speaker = v[1].trim();
  const text = line
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
  return speaker ? { text, speaker } : { text };
}

/**
 * Both formats at once: a block is a cue when it has a "start --> end"
 * line; anything before it (a number, an identifier) is ignored, and the
 * lines after it are the text. WEBVTT headers, NOTE and STYLE blocks fall
 * out because they have no arrow.
 */
export function parseCaptions(source: string): Segment[] {
  const blocks = source.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const out: Segment[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at === -1) continue;
    if (lines[0].startsWith('NOTE') || lines[0].startsWith('STYLE')) continue;
    const [a, b] = lines[at].split('-->').map((s) => s.trim().split(/\s+/)[0]);
    const start = parseTimestamp(a);
    const end = parseTimestamp(b);
    if (start === null || end === null) continue;
    const textLines = lines.slice(at + 1).map(cleanLine);
    const text = textLines.map((l) => l.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const speaker = textLines.find((l) => l.speaker)?.speaker;
    out.push(speaker ? { start, end: Math.max(end, start), text, speaker } : { start, end: Math.max(end, start), text });
  }
  return out.sort((x, y) => x.start - y.start);
}

export function toVtt(segments: Segment[]): string {
  const cues = segments.map((s, i) => {
    const text = s.speaker ? `<v ${s.speaker}>${s.text}` : s.text;
    return `${i + 1}\n${formatTimestamp(s.start)} --> ${formatTimestamp(s.end)}\n${text}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export function fullTextOf(segments: Segment[]): string {
  return segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export interface Hit {
  start: number;
  text: string;
}

/** The segments that contain the words, case-insensitively, every word present. */
export function searchSegments(segments: Segment[], query: string, limit = 20): Hit[] {
  const words = query.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const hits: Hit[] = [];
  for (const s of segments) {
    const low = s.text.toLowerCase();
    if (words.every((w) => low.includes(w))) {
      hits.push({ start: s.start, text: s.text });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** The segment playing at this second, for the transcript tab to follow along. */
export function segmentIndexAt(segments: Segment[], seconds: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= seconds) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * Paragraphs for reading: segments joined until a gap of a few seconds or
 * a few hundred characters, so the tab reads as prose rather than as a
 * list of three-word lines.
 */
export function paragraphs(segments: Segment[], opts: { gapSeconds?: number; maxChars?: number } = {}): { start: number; text: string }[] {
  const gap = opts.gapSeconds ?? 4;
  const max = opts.maxChars ?? 400;
  const out: { start: number; text: string }[] = [];
  let current: { start: number; end: number; text: string } | null = null;
  for (const s of segments) {
    if (current && s.start - current.end <= gap && current.text.length + s.text.length < max) {
      current.text = `${current.text} ${s.text}`;
      current.end = s.end;
    } else {
      if (current) out.push({ start: current.start, text: current.text });
      current = { start: s.start, end: s.end, text: s.text };
    }
  }
  if (current) out.push({ start: current.start, text: current.text });
  return out;
}

export const CAPTION_MAX_BYTES = 2 * 1024 * 1024;

export function captionFileProblem(name: string, size: number): string | null {
  if (!/\.(vtt|srt)$/i.test(name)) return 'Upload a .vtt or .srt file.';
  if (size > CAPTION_MAX_BYTES) return 'That caption file is too large.';
  return null;
}
