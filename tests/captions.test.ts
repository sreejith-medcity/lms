import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captionFileProblem,
  formatTimestamp,
  fullTextOf,
  paragraphs,
  parseCaptions,
  parseTimestamp,
  searchSegments,
  segmentIndexAt,
  toVtt,
  wordCount,
} from '../src/lib/captions';

const vtt = `WEBVTT

NOTE made by hand

1
00:00:01.000 --> 00:00:03.500
<v Priya>Guten Abend, alle zusammen.

2
00:00:03.600 --> 00:00:06.000
Heute sprechen wir über das <i>Perfekt</i>.

00:01:02.000 --> 00:01:05.250
Ich habe mich gefreut.
Das ist Perfekt.
`;

const srt = `1
00:00:01,000 --> 00:00:03,500
Good evening everyone.

2
00:00:03,600 --> 00:00:06,000
Today: the perfect tense.
`;

test('timestamps read both ways and write back', () => {
  assert.equal(parseTimestamp('00:01:02.500'), 62.5);
  assert.equal(parseTimestamp('01:02.500'), 62.5);
  assert.equal(parseTimestamp('00:00:03,500'), 3.5);
  assert.equal(parseTimestamp('nonsense'), null);
  assert.equal(formatTimestamp(3723.4), '01:02:03.400');
});

test('VTT parses into segments, with speaker and markup handled', () => {
  const s = parseCaptions(vtt);
  assert.equal(s.length, 3);
  assert.deepEqual(s[0], { start: 1, end: 3.5, text: 'Guten Abend, alle zusammen.', speaker: 'Priya' });
  assert.equal(s[1].text, 'Heute sprechen wir über das Perfekt.');
  assert.equal(s[2].text, 'Ich habe mich gefreut. Das ist Perfekt.');
  assert.equal(s[2].start, 62);
});

test('SRT parses the same way, and CRLF does not matter', () => {
  const s = parseCaptions(srt.replace(/\n/g, '\r\n'));
  assert.equal(s.length, 2);
  assert.equal(s[1].text, 'Today: the perfect tense.');
});

test('segments write out as VTT the browser will take, and back again', () => {
  const s = parseCaptions(srt);
  const out = toVtt(s);
  assert.ok(out.startsWith('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500\nGood evening everyone.'));
  assert.deepEqual(parseCaptions(out), s);
});

test('the full text and word count', () => {
  const s = parseCaptions(srt);
  assert.equal(fullTextOf(s), 'Good evening everyone. Today: the perfect tense.');
  assert.equal(wordCount(fullTextOf(s)), 7);
});

test('search finds the segment with every word, case-insensitively', () => {
  const s = parseCaptions(vtt);
  assert.deepEqual(searchSegments(s, 'perfekt'), [
    { start: 3.6, text: 'Heute sprechen wir über das Perfekt.' },
    { start: 62, text: 'Ich habe mich gefreut. Das ist Perfekt.' },
  ]);
  assert.deepEqual(searchSegments(s, 'gefreut perfekt'), [{ start: 62, text: 'Ich habe mich gefreut. Das ist Perfekt.' }]);
  assert.deepEqual(searchSegments(s, 'a'), []);
});

test('the segment playing now is found by binary search', () => {
  const s = parseCaptions(vtt);
  assert.equal(segmentIndexAt(s, 0), -1);
  assert.equal(segmentIndexAt(s, 2), 0);
  assert.equal(segmentIndexAt(s, 4), 1);
  assert.equal(segmentIndexAt(s, 90), 2);
});

test('paragraphs join close segments and break on a gap', () => {
  const p = paragraphs(parseCaptions(vtt));
  assert.equal(p.length, 2);
  assert.equal(p[0].text, 'Guten Abend, alle zusammen. Heute sprechen wir über das Perfekt.');
  assert.equal(p[1].start, 62);
});

test('caption uploads are vtt or srt and small', () => {
  assert.equal(captionFileProblem('lesson.vtt', 1000), null);
  assert.equal(captionFileProblem('lesson.SRT', 1000), null);
  assert.equal(captionFileProblem('lesson.txt', 1000), 'Upload a .vtt or .srt file.');
  assert.match(captionFileProblem('lesson.vtt', 5 * 1024 * 1024) ?? '', /too large/);
});
