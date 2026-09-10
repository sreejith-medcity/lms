import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlockSource, toBlockSource } from '../src/lib/block-source';
import type { Block } from '../src/lib/page-blocks';

const SOURCE = `## What this course is

Structured NCLEX-RN preparation.

Taught live, with recordings.

## What you will learn
- Pharmacology
- Prioritisation

## Questions
? How long is it
: Six months.
? Are there recordings
: Yes.

= 18 | branches
= 14,611 | Google reviews

![A class in progress](https://cdn.example.com/class.jpg)

> Seats fill a fortnight before each batch | See dates and fees`;

test('every kind of block is read out of the source', () => {
  const blocks = parseBlockSource(SOURCE);
  assert.deepEqual(blocks.map((b) => b.type), [
    'text',
    'bullets',
    'faq',
    'stats',
    'image',
    'cta',
  ]);
});

test('a heading attaches to the block under it, not the one before', () => {
  const [text, bullets, faq] = parseBlockSource(SOURCE);
  assert.equal(text.type === 'text' && text.heading, 'What this course is');
  assert.equal(bullets.type === 'bullets' && bullets.heading, 'What you will learn');
  assert.equal(faq.type === 'faq' && faq.heading, 'Questions');
});

test('a blank line separates paragraphs and a wrapped line does not', () => {
  const [text] = parseBlockSource('One sentence\nwrapped over two lines.\n\nA second paragraph.');
  assert.equal(
    text.type === 'text' && text.body,
    'One sentence wrapped over two lines.\n\nA second paragraph.',
  );
});

test('what comes out goes back in unchanged', () => {
  const blocks = parseBlockSource(SOURCE);
  const again = parseBlockSource(toBlockSource(blocks));
  assert.deepEqual(again, blocks);
});

test('an uploaded image survives the round trip as an asset, not a url', () => {
  const blocks: Block[] = [{ type: 'image', assetId: 'abc123', alt: 'Classroom' }];
  const source = toBlockSource(blocks);
  assert.equal(source, '![Classroom](asset:abc123)');

  const [back] = parseBlockSource(source);
  assert.equal(back.type === 'image' && back.assetId, 'abc123');
  assert.equal(back.type === 'image' && back.url, undefined);
  assert.equal(back.type === 'image' && back.alt, 'Classroom');
});

test('an answer with no question above it joins the answer before it', () => {
  const [faq] = parseBlockSource('? Why\n: Because.\n: And also this.');
  assert.equal(faq.type === 'faq' && faq.items[0].a, 'Because.\n\nAnd also this.');
});

test('a stat with no label is not half a stat', () => {
  assert.deepEqual(parseBlockSource('= 18'), []);
  assert.equal(parseBlockSource('= 18 | branches').length, 1);
});

test('empty source is an empty page rather than an error', () => {
  assert.deepEqual(parseBlockSource(''), []);
  assert.deepEqual(parseBlockSource('\n\n   \n'), []);
  assert.equal(toBlockSource([]), '');
});

test('windows line endings are read the same as any other', () => {
  const blocks = parseBlockSource('## Heading\r\n\r\nA paragraph.\r\n- one\r\n- two');
  assert.deepEqual(blocks.map((b) => b.type), ['text', 'bullets']);
});

test('markup pasted into the editor is text, never markup', () => {
  const [text] = parseBlockSource('<script>alert(1)</script> and <b>bold</b>');
  assert.equal(text.type === 'text' && text.body, '<script>alert(1)</script> and <b>bold</b>');
  // It renders as characters: the page renderer never sets innerHTML.
});
