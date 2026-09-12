import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byQuestion, parseBulkForm, percentOf, publishable } from '../src/lib/bulk-marking';

const papers = [
  { attemptId: 'a1', objective: 6, toMark: [{ questionId: 'q7', maxMarks: 10, current: null }, { questionId: 'q8', maxMarks: 5, current: null }] },
  { attemptId: 'a2', objective: 4, toMark: [{ questionId: 'q7', maxMarks: 10, current: 7 }, { questionId: 'q8', maxMarks: 5, current: 3 }] },
  { attemptId: 'a3', objective: 8, toMark: [{ questionId: 'q7', maxMarks: 10, current: null }, { questionId: 'q8', maxMarks: 5, current: null }] },
];

test('typed marks are read, clamped to the ceiling, and totalled with the objective part', () => {
  const form: Record<string, string> = { 'marks:a1:q7': '8', 'marks:a1:q8': '9', 'feedback:a1': 'Good letter.' };
  const [p1] = parseBulkForm(papers, (k) => form[k] ?? null);
  assert.deepEqual(p1.marks, { q7: 8, q8: 5 });
  assert.equal(p1.complete, true);
  assert.equal(p1.total, 6 + 8 + 5);
  assert.equal(p1.feedback, 'Good letter.');
});

test('a blank box falls back to the draft mark, and a paper with no draft and no mark stays incomplete', () => {
  const parsed = parseBulkForm(papers, () => null);
  const [p1, p2, p3] = parsed;
  assert.equal(p1.complete, false);
  assert.equal(p2.complete, true, 'the AI draft fills the gaps');
  assert.deepEqual(p2.marks, { q7: 7, q8: 3 });
  assert.equal(p2.touched, false);
  assert.equal(p3.complete, false);
  assert.deepEqual(publishable(parsed, true).map((p) => p.attemptId), [], 'nothing typed, nothing published');
  assert.deepEqual(publishable(parsed, false).map((p) => p.attemptId), ['a2'], 'unless drafts are accepted as they stand');
});

test('half a paper is not published with a zero nobody typed', () => {
  const form: Record<string, string> = { 'marks:a1:q7': '8' };
  const parsed = parseBulkForm(papers, (k) => form[k] ?? null);
  assert.equal(parsed[0].complete, false);
  assert.equal(publishable(parsed, true).length, 0);
});

test('nonsense in a box is treated as blank', () => {
  const form: Record<string, string> = { 'marks:a2:q7': 'ten' };
  const [, p2] = parseBulkForm(papers, (k) => form[k] ?? null);
  assert.equal(p2.marks.q7, 7);
});

test('percent and grouping', () => {
  assert.equal(percentOf(19, 21), 90.5);
  assert.equal(percentOf(-2, 21), 0);
  const rows = [{ attemptId: 'a1', questionId: 'q8' }, { attemptId: 'a1', questionId: 'q7' }, { attemptId: 'a2', questionId: 'q7' }];
  const grouped = byQuestion(rows, ['q7', 'q8']);
  assert.deepEqual(grouped.map((g) => [g.questionId, g.rows.length]), [['q7', 2], ['q8', 1]]);
});
