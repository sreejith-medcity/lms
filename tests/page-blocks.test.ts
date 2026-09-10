import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageSummary, paragraphs, parseBlocks } from '../src/lib/page-blocks';

test('a well formed page comes back whole', () => {
  const blocks = parseBlocks([
    { type: 'text', heading: 'About the course', body: 'One paragraph.\n\nAnother.' },
    { type: 'bullets', heading: 'You will learn', items: ['Speaking', 'Listening'] },
    { type: 'faq', items: [{ q: 'How long?', a: 'Six months.' }] },
    { type: 'stats', items: [{ value: '18', label: 'branches' }] },
    { type: 'image', url: 'https://example.com/a.jpg', alt: 'A classroom' },
    { type: 'cta', heading: 'Ready?', label: 'Enrol now' },
  ]);

  assert.equal(blocks.length, 6);
  assert.deepEqual(blocks.map((b) => b.type), ['text', 'bullets', 'faq', 'stats', 'image', 'cta']);
});

test('anything unrecognised is dropped rather than rendered', () => {
  const blocks = parseBlocks([
    { type: 'script', src: 'https://evil.example/x.js' },
    { type: 'text' },
    { type: 'text', body: '   ' },
    { type: 'bullets', items: [] },
    'a string',
    null,
    42,
  ]);

  assert.deepEqual(blocks, []);
});

test('a json column holding something else does not throw', () => {
  for (const raw of [null, undefined, {}, 'blocks', 7]) {
    assert.deepEqual(parseBlocks(raw), []);
  }
});

test('an image over plain http is refused, since the page is https', () => {
  assert.deepEqual(parseBlocks([{ type: 'image', url: 'http://example.com/a.jpg' }]), []);
  assert.equal(parseBlocks([{ type: 'image', url: 'https://example.com/a.jpg' }]).length, 1);
});

test('an uploaded image wins over a remote url on the same block', () => {
  const [block] = parseBlocks([
    { type: 'image', assetId: 'asset123', url: 'https://example.com/a.jpg' },
  ]);
  assert.equal(block.type === 'image' && block.assetId, 'asset123');
  assert.equal(block.type === 'image' && block.url, undefined);
});

test('faq entries missing half the pair are left out', () => {
  const blocks = parseBlocks([
    { type: 'faq', items: [{ q: 'Only a question' }, { a: 'Only an answer' }, { q: 'Q', a: 'A' }] },
  ]);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].type === 'faq' && blocks[0].items, [{ q: 'Q', a: 'A' }]);
});

test('runaway content is trimmed rather than accepted', () => {
  const blocks = parseBlocks([
    { type: 'text', body: 'x'.repeat(20000) },
    { type: 'bullets', items: Array.from({ length: 500 }, (_, i) => `item ${i}`) },
  ]);
  assert.equal(blocks[0].type === 'text' && blocks[0].body.length, 8000);
  assert.equal(blocks[1].type === 'bullets' && blocks[1].items.length, 60);
});

test('a page cannot be a thousand blocks long', () => {
  const many = Array.from({ length: 200 }, () => ({ type: 'text', body: 'hello' }));
  assert.equal(parseBlocks(many).length, 80);
});

test('paragraphs split on blank lines and drop the empties', () => {
  assert.deepEqual(paragraphs('one\n\n\ntwo\n\n  \n\nthree'), ['one', 'two', 'three']);
  assert.deepEqual(paragraphs('   '), []);
});

test('the summary is the first real sentence, cut cleanly', () => {
  const blocks = parseBlocks([
    { type: 'image', url: 'https://example.com/a.jpg' },
    { type: 'text', body: 'Prepare for the NCLEX-RN with structured practice.' },
  ]);
  assert.equal(pageSummary(blocks), 'Prepare for the NCLEX-RN with structured practice.');

  const long = parseBlocks([{ type: 'text', body: 'word '.repeat(100) }]);
  const summary = pageSummary(long, 40);
  assert.ok(summary.length <= 40, summary);
  assert.ok(summary.endsWith('…'));
});

test('a page with nothing to say summarises to nothing, not to undefined', () => {
  assert.equal(pageSummary([]), '');
});

test('the untyped blocks the static pages were written with still read', () => {
  const blocks = parseBlocks([
    { heading: 'Who we are', body: 'Eighteen branches across Kerala.' },
    { heading: '', body: '' },
  ]);

  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], {
    type: 'text',
    heading: 'Who we are',
    body: 'Eighteen branches across Kerala.',
  });
});
