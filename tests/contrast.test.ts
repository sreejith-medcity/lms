import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  ratioOf,
  parseHex,
  contrastRatio,
  tokensIn,
  rawTokensIn,
  resolveColor,
  splitThemes,
  AA_TEXT,
} from '../src/lib/contrast';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src', 'app', 'globals.css'), 'utf8');
const themes = splitThemes(css);

/** Text colours, and every background they are actually set against. */
const TEXT_ON = ['ink', 'ink-2', 'ink-3'];
const BACKGROUNDS = ['surface', 'surface-2', 'canvas'];

for (const [name, block] of [
  ['light', themes.light],
  ['dark', themes.dark],
] as const) {
  test(`${name} theme: every text colour clears AA on every background it is used on`, () => {
    const tokens = tokensIn(block);
    assert.ok(tokens['ink-3'], `no --ink-3 found in the ${name} block`);

    const failures: string[] = [];

    for (const fg of TEXT_ON) {
      for (const bg of BACKGROUNDS) {
        if (!tokens[fg] || !tokens[bg]) continue;
        const ratio = ratioOf(tokens[fg], tokens[bg]);
        if (ratio < AA_TEXT) {
          failures.push(
            `--${fg} (${tokens[fg]}) on --${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}`,
          );
        }
      }
    }

    assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
  });
}

test('the two button colourways are readable', () => {
  const tokens = tokensIn(themes.light);
  // White on the brand purple, and the brand purple on amber. Both are text
  // somebody has to read to know what a button does.
  assert.ok(ratioOf(tokens['brand-ink'], tokens.brand) >= AA_TEXT);
  assert.ok(ratioOf(tokens['accent-ink'], tokens.accent) >= AA_TEXT);
});

test('status colours are readable on their own soft backgrounds', () => {
  const tokens = tokensIn(themes.light);
  for (const kind of ['warn', 'bad', 'good']) {
    if (!tokens[kind] || !tokens[`${kind}-soft`]) continue;
    const ratio = ratioOf(tokens[kind], tokens[`${kind}-soft`]);
    assert.ok(ratio >= AA_TEXT, `--${kind} on --${kind}-soft is ${ratio.toFixed(2)}:1`);
  }
});

test('the muted greys stay distinguishable from each other', () => {
  // If accessibility pushes every grey to the same darkness the hierarchy is
  // gone, and three tokens are doing one job. This is the check that the fix
  // for contrast did not quietly flatten the design.
  const tokens = tokensIn(themes.light);
  const ink = ratioOf(tokens.ink, tokens.surface);
  const ink2 = ratioOf(tokens['ink-2'], tokens.surface);
  const ink3 = ratioOf(tokens['ink-3'], tokens.surface);
  assert.ok(ink > ink2, 'ink should be stronger than ink-2');
  assert.ok(ink2 > ink3, 'ink-2 should be stronger than ink-3');
});

/* The arithmetic itself, against values with known answers. */

test('the maths matches the published examples', () => {
  // Black on white is the definitional 21:1; a colour against itself is 1:1.
  assert.equal(Math.round(ratioOf('#000000', '#ffffff')), 21);
  assert.equal(Math.round(ratioOf('#777777', '#777777')), 1);
  // WCAG's own worked example: #777 on white is just under 4.5.
  assert.ok(Math.abs(ratioOf('#777777', '#ffffff') - 4.48) < 0.02);
});

test('shorthand hex and a missing hash are both understood', () => {
  assert.deepEqual(parseHex('#fff'), [255, 255, 255]);
  assert.deepEqual(parseHex('000'), [0, 0, 0]);
  assert.equal(parseHex('nonsense'), null);
  assert.equal(parseHex('#12345'), null);
});

test('order does not change the ratio', () => {
  const a = parseHex('#322046')!;
  const b = parseHex('#fdb85b')!;
  assert.equal(contrastRatio(a, b), contrastRatio(b, a));
});

/**
 * The tinted panels.
 *
 * The three surfaces above are not the only backgrounds text sits on: the
 * product also has soft brand and amber panels, and those are `color-mix`
 * values the plain token reader skips. A note on one of them measured 4.36:1
 * and nothing caught it, because the check could not see the background. It
 * can now.
 */
for (const [name, block] of [
  ['light', themes.light],
  ['dark', themes.dark],
] as const) {
  test(`${name} theme: text on the tinted panels clears AA`, () => {
    const raw = rawTokensIn(block);
    const failures: string[] = [];

    for (const bgName of ['brand-soft', 'accent-soft', 'ok-soft', 'warn-soft', 'bad-soft']) {
      const bg = resolveColor(raw[bgName], raw);
      if (!bg) continue;

      // ink-3 is deliberately absent: it is the faintest grey in the product
      // and it is not for tinted panels. Anything written on one of these uses
      // ink or ink-2, and this is what holds that line.
      for (const fgName of ['ink', 'ink-2']) {
        const fg = resolveColor(raw[fgName], raw);
        if (!fg) continue;
        const ratio = contrastRatio(fg, bg);
        if (ratio < AA_TEXT) {
          failures.push(`--${fgName} on --${bgName} is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}`);
        }
      }
    }

    assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
  });
}

test('the accent panel can carry the warning ink, which is what the badges use', () => {
  const raw = rawTokensIn(themes.light);
  const bg = resolveColor(raw['accent-soft'], raw);
  const fg = resolveColor(raw.warn, raw);
  assert.ok(bg && fg);
  const ratio = contrastRatio(fg!, bg!);
  assert.ok(ratio >= AA_TEXT, `--warn on --accent-soft is ${ratio.toFixed(2)}:1`);
});

test('resolveColor follows a var and a color-mix, and gives up rather than guessing', () => {
  const tokens = { brand: '#322046', soft: 'color-mix(in srgb, var(--brand) 10%, white)' };
  assert.deepEqual(resolveColor('var(--brand)', tokens), [0x32, 0x20, 0x46]);
  // 10% of #322046 over white, channel by channel.
  assert.deepEqual(resolveColor(tokens.soft, tokens), [235, 233, 237]);
  assert.equal(resolveColor('oklch(0.6 0.1 200)', tokens), null);
  assert.equal(resolveColor('var(--nope)', tokens), null);
});

/**
 * The dark panel.
 *
 * The home page hero and the closing band on a course page both put text on
 * the shell purple, which is a background no automated sweep of the rendered
 * page can measure: it is painted with a gradient, and a gradient lives in
 * background-image where `backgroundColor` reads as transparent. A browser
 * check therefore reports white behind it and fails every line on the panel.
 * These are the numbers that sweep cannot see.
 */
test('text on the dark panel is readable', () => {
  const raw = rawTokensIn(themes.light);
  const shell = resolveColor(raw.shell, raw);
  assert.ok(shell, 'no --shell');

  const failures: string[] = [];
  for (const [name, need] of [
    ['shell-ink', AA_TEXT],
    ['shell-muted', AA_TEXT],
    // The amber is the headline's second line and the button face, both large.
    ['accent', AA_TEXT],
  ] as const) {
    const fg = resolveColor(raw[name], raw);
    if (!fg) {
      failures.push(`--${name} did not resolve`);
      continue;
    }
    const ratio = contrastRatio(fg, shell!);
    if (ratio < need) failures.push(`--${name} on --shell is ${ratio.toFixed(2)}:1, needs ${need}`);
  }

  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

test('the line on the dark panel is visible without being a border of its own', () => {
  const raw = rawTokensIn(themes.light);
  const line = resolveColor(raw['shell-line'], raw);
  const shell = resolveColor(raw.shell, raw);
  assert.ok(line && shell);
  const ratio = contrastRatio(line!, shell!);
  // Not text, so 3:1 is the wrong bar. It has to be seen and not shouted.
  assert.ok(ratio > 1.2, `--shell-line on --shell is ${ratio.toFixed(2)}:1, which is invisible`);
  assert.ok(ratio < 4, `--shell-line on --shell is ${ratio.toFixed(2)}:1, which is a stripe`);
});

test('the accent used as text clears large-text AA on the pages it appears on', () => {
  // The hero's second line is set in --accent-strong rather than --accent,
  // because the amber itself is a surface colour: 1.61:1 on the canvas. The
  // threshold here is the large-text one, which is what a 40px headline is
  // judged against, and the light theme clears it with room to spare.
  const LARGE = 3;

  for (const [name, block] of [
    ['light', themes.light],
    ['dark', themes.dark],
  ] as const) {
    const tokens = tokensIn(block);
    if (!tokens['accent-strong']) continue;

    for (const bg of ['canvas', 'surface'] as const) {
      if (!tokens[bg]) continue;
      const ratio = ratioOf(tokens['accent-strong'], tokens[bg]);
      assert.ok(
        ratio >= LARGE,
        `${name}: --accent-strong (${tokens['accent-strong']}) on --${bg} is ${ratio.toFixed(2)}:1`,
      );
    }
  }
});
