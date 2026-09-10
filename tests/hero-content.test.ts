import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCaption, parseHighlights } from '../src/lib/hero-content';

test('a line each becomes a claim and its explanation', () => {
  const items = parseHighlights(
    'Live Classes | Learn from experts\nMock Tests | Practice with confidence',
  );
  assert.deepEqual(items, [
    { label: 'Live Classes', detail: 'Learn from experts' },
    { label: 'Mock Tests', detail: 'Practice with confidence' },
  ]);
});

test('a claim with no explanation is still a claim', () => {
  assert.deepEqual(parseHighlights('Career Support'), [
    { label: 'Career Support', detail: '' },
  ]);
});

test('blank lines, stray spacing and a trailing separator are tidied', () => {
  const items = parseHighlights('\n  Live Classes |  \n\n  Mock Tests | Practice \n');
  assert.deepEqual(items, [
    { label: 'Live Classes', detail: '' },
    { label: 'Mock Tests', detail: 'Practice' },
  ]);
});

test('a fifth claim is dropped rather than wrapped onto a second row', () => {
  const items = parseHighlights(['a', 'b', 'c', 'd', 'e'].map((l) => `${l} | x`).join('\n'));
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((i) => i.label), ['a', 'b', 'c', 'd']);
});

test('a separator inside the explanation is kept', () => {
  assert.deepEqual(parseHighlights('Flexible | Morning | evening | weekend'), [
    { label: 'Flexible', detail: 'Morning | evening | weekend' },
  ]);
});

test('nothing set means no strip, not an empty one', () => {
  assert.deepEqual(parseHighlights(''), []);
  assert.deepEqual(parseHighlights('\n \n'), []);
  assert.deepEqual(parseHighlights('| only a detail'), []);
});

test('the caption is one title and one line', () => {
  assert.deepEqual(parseCaption('LMS Inauguration | A brighter future for learners.'), {
    title: 'LMS Inauguration',
    detail: 'A brighter future for learners.',
  });
  assert.deepEqual(parseCaption('Just a title'), { title: 'Just a title', detail: '' });
  assert.equal(parseCaption('   '), null);
});

test('runaway text is cut rather than allowed to break the card', () => {
  const long = parseCaption(`${'t'.repeat(200)} | ${'d'.repeat(400)}`);
  assert.equal(long?.title.length, 60);
  assert.equal(long?.detail.length, 120);
});
