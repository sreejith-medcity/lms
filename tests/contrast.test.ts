import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { ratioOf, parseHex, contrastRatio, tokensIn, splitThemes, AA_TEXT } from '../src/lib/contrast';

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
