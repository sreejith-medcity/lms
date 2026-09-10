/**
 * The three list-shaped settings behind the home page hero.
 *
 * A row of claims and a caption card are content, not code: one academy
 * wants "Live classes, Mock tests, Flexible learning, Career support" and
 * the next wants three things about placements. But a settings screen with
 * eleven separate boxes for one strip is a screen nobody fills in, so each of
 * these is one field written a line at a time:
 *
 *   Live Classes | Learn from experts
 *   Mock Tests | Practice with confidence
 *
 * Pure, so the parsing is tested rather than discovered on the live site: a
 * missing separator, a blank line or somebody pasting eleven rows should all
 * end in a hero that still looks deliberate.
 */

export interface HeroHighlight {
  label: string;
  detail: string;
}

/** Four fit across a wide screen and two across a phone. A fifth wraps badly. */
export const MAX_HIGHLIGHTS = 4;

function split(line: string): [string, string] {
  const [label, ...rest] = line.split('|');
  return [label.trim(), rest.join('|').trim()];
}

export function parseHighlights(raw: string): HeroHighlight[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(split)
    .filter(([label]) => label.length > 0)
    .slice(0, MAX_HIGHLIGHTS)
    .map(([label, detail]) => ({ label: label.slice(0, 40), detail: detail.slice(0, 80) }));
}

export function parseCaption(raw: string): { title: string; detail: string } | null {
  const [title, detail] = split(raw.replace(/\n/g, ' ').trim());
  if (!title) return null;
  return { title: title.slice(0, 60), detail: detail.slice(0, 120) };
}
