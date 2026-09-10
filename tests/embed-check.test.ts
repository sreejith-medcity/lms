import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEmbed } from '../src/lib/embed-check';

test('the real snippet passes', () => {
  assert.equal(
    checkEmbed(`<script defer async src='https://cdn.trustindex.io/loader.js?0213afa784fe31746a36285629e'></script>`),
    null,
  );
});

test('the exact paste that broke the hero is caught', () => {
  // Straight from the settings row: a chat app turned the URL into a link and
  // left a bracket welded onto the widget id. Trustindex reported it as a typo
  // in the id, which sent the search to the wrong place entirely.
  const mangled =
    `<script defer async src='https://cdn.trustindex.io/loader.js?8c1694f782df771e219662de9d6['>]` +
    `(https://cdn.trustindex.io/loader.js?8c1694f782df771e219662de9d6%27%3E)</script>`;
  const found = checkEmbed(mangled);
  assert.ok(found, 'the mangled paste was accepted');
  assert.match(found!.detail, /stray character/);
});

test('a plain markdown link anywhere in the value is caught too', () => {
  const found = checkEmbed('<div>see [our reviews](https://example.com/reviews)</div>');
  assert.ok(found);
  assert.match(found!.problem, /markdown link/);
});

test('an http embed is refused, because a browser will block it anyway', () => {
  const found = checkEmbed(`<script src="http://cdn.example.com/loader.js"></script>`);
  assert.ok(found);
  assert.match(found!.detail, /https/);
});

test('nothing to check is not a problem', () => {
  assert.equal(checkEmbed(''), null);
  assert.equal(checkEmbed('   '), null);
});

test('a snippet with no src at all is left alone', () => {
  // Some providers ship a div plus an inline script.
  assert.equal(checkEmbed('<div data-widget-id="abc"></div><script>window.x=1</script>'), null);
});
