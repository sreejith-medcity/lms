/**
 * Contrast, as arithmetic rather than opinion.
 *
 * A palette is agreed by looking at it on a good screen in a quiet room, which
 * is not where anybody reads a course page. The muted grey in this product
 * measured 2.72:1 against the page background: perfectly legible to the person
 * who chose it, and not legible to a learner on a phone in daylight.
 *
 * WCAG AA is 4.5:1 for body text and 3:1 for large text. Those numbers are
 * checkable, so they are checked.
 */

export type Rgb = [number, number, number];

export function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, '');

  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Relative luminance, per WCAG 2.1. */
export function luminance([r, g, b]: Rgb): number {
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Convenience over two hex strings. Throws on rubbish rather than guessing. */
export function ratioOf(foreground: string, background: string): number {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) throw new Error(`Not a hex colour: ${foreground} on ${background}`);
  return contrastRatio(fg, bg);
}

export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;

/**
 * Read the custom properties out of a stylesheet, one block at a time.
 *
 * Crude on purpose: it wants the light block and the dark block separately,
 * and a selector is how they are told apart. Values that are not plain hex,
 * such as the `color-mix` ones, are skipped rather than guessed at.
 */
export function tokensIn(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[name] = value;
  }
  return out;
}

/** The light block is everything before the first dark-mode selector. */
export function splitThemes(css: string): { light: string; dark: string } {
  const at = css.search(/@media \(prefers-color-scheme: dark\)|\[data-theme=["']dark["']\]/);
  return at < 0 ? { light: css, dark: '' } : { light: css.slice(0, at), dark: css.slice(at) };
}

/** Two colours mixed in sRGB, the way `color-mix(in srgb, a p%, b)` does it. */
export function mix(a: Rgb, b: Rgb, percentA: number): Rgb {
  const w = Math.max(0, Math.min(100, percentA)) / 100;
  return [
    Math.round(a[0] * w + b[0] * (1 - w)),
    Math.round(a[1] * w + b[1] * (1 - w)),
    Math.round(a[2] * w + b[2] * (1 - w)),
  ];
}

const NAMED: Record<string, Rgb> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  transparent: [255, 255, 255],
};

/**
 * Resolve one token value to a colour, following `var()` and `color-mix()`.
 *
 * The tinted panels in this product are all `color-mix` over another token,
 * which the plain reader skips. That is how a panel background escaped the
 * contrast test long enough for text on it to measure 4.36:1: the check only
 * knew about the colours it could parse. Anything still unresolvable comes
 * back null, and a caller that gets null should skip rather than assume.
 */
export function resolveColor(
  value: string | undefined,
  tokens: Record<string, string>,
  depth = 0,
): Rgb | null {
  if (!value || depth > 4) return null;
  const v = value.trim();

  const named = NAMED[v.toLowerCase()];
  if (named) return named;

  const direct = parseHex(v);
  if (direct) return direct;

  const varMatch = v.match(/^var\(\s*--([\w-]+)\s*\)$/);
  if (varMatch) return resolveColor(tokens[varMatch[1]], tokens, depth + 1);

  const mixMatch = v.match(/^color-mix\(\s*in srgb\s*,\s*(.+?)\s+(\d+)%\s*,\s*(.+?)\s*\)$/);
  if (mixMatch) {
    const a = resolveColor(mixMatch[1], tokens, depth + 1);
    const b = resolveColor(mixMatch[3], tokens, depth + 1);
    if (!a || !b) return null;
    return mix(a, b, Number(mixMatch[2]));
  }

  return null;
}

/** Every custom property in a block, hex or not, for resolveColor to chew on. */
export function rawTokensIn(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}
