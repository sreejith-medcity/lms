import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankCount,
  displayOrder,
  isAnswered,
  keyProblem,
  markAuto,
  normalise,
  parseAnswerKey,
  readSectionClock,
  sectionState,
  splitBlanks,
} from '../src/lib/question-scoring';

const opts = [
  { id: 'a', isCorrect: false },
  { id: 'b', isCorrect: true },
  { id: 'c', isCorrect: true },
];

test('choice questions are all or nothing, and a blank costs nothing', () => {
  const base = { type: 'MCQ_MULTI', marks: 2, negativeMarks: 0.5, options: opts, answerKey: null };
  assert.deepEqual(markAuto({ ...base, response: ['b', 'c'] }), { isCorrect: true, marksAwarded: 2, parts: { right: 1, total: 1 } });
  assert.equal(markAuto({ ...base, response: ['b'] }).marksAwarded, -0.5);
  assert.equal(markAuto({ ...base, response: [] }).isCorrect, null);
  assert.equal(markAuto({ ...base, response: null }).marksAwarded, 0);
});

test('blanks are counted from the prompt and the key must agree', () => {
  assert.equal(blankCount('The capital of ___ is ___.'), 2);
  assert.deepEqual(splitBlanks('A ___ b'), ['A ', ' b']);
  const key = parseAnswerKey('FILL_BLANK', { blanks: [['Germany', 'Deutschland'], ['Berlin']] });
  assert.ok(key);
  assert.equal(keyProblem('FILL_BLANK', 'The capital of ___ is ___.', key), null);
  assert.match(keyProblem('FILL_BLANK', 'The capital of ___ is Berlin.', key) ?? '', /1 blank but 2 answer lines/);
  assert.match(keyProblem('FILL_BLANK', 'No gaps here', key) ?? '', /three underscores/);
});

test('blanks earn a share per part, forgiving case, spacing and a full stop', () => {
  const base = { type: 'FILL_BLANK', marks: 4, negativeMarks: 1, options: [], answerKey: { blanks: [['Germany', 'Deutschland'], ['Berlin']] } };
  assert.deepEqual(markAuto({ ...base, response: ['deutschland ', 'BERLIN.'] }), { isCorrect: true, marksAwarded: 4, parts: { right: 2, total: 2 } });
  assert.deepEqual(markAuto({ ...base, response: ['Germany', 'Bonn'] }), { isCorrect: false, marksAwarded: 2, parts: { right: 1, total: 2 } });
  assert.equal(markAuto({ ...base, response: ['France', 'Paris'] }).marksAwarded, -1, 'nothing right costs the negative mark');
  assert.equal(markAuto({ ...base, response: ['', ''] }).isCorrect, null, 'blank is blank');
});

test('case-sensitive blanks stay strict', () => {
  const key = { blanks: [['Sie']], caseSensitive: true };
  assert.equal(markAuto({ type: 'FILL_BLANK', marks: 1, negativeMarks: 0, options: [], answerKey: key, response: ['sie'] }).isCorrect, false);
  assert.equal(normalise('  Hello,  world! ', false), 'hello, world');
});

test('pairs earn a share per match', () => {
  const answerKey = { pairs: [{ left: 'der', right: 'Mann' }, { left: 'die', right: 'Frau' }, { left: 'das', right: 'Kind' }] };
  const base = { type: 'MATCH', marks: 3, negativeMarks: 0, options: [], answerKey };
  assert.equal(markAuto({ ...base, response: [0, 1, 2] }).marksAwarded, 3);
  assert.deepEqual(markAuto({ ...base, response: [0, 2, 1] }).parts, { right: 1, total: 3 });
  assert.equal(markAuto({ ...base, response: [0, 2, 1] }).marksAwarded, 1);
  assert.equal(markAuto({ ...base, response: [-1, -1, -1] }).isCorrect, null);
  assert.match(keyProblem('MATCH', '', parseAnswerKey('MATCH', { pairs: [{ left: 'a', right: 'x' }, { left: 'b', right: 'x' }] })) ?? '', /same right-hand side/);
});

test('an order is right or it is not', () => {
  const base = { type: 'ORDERING', marks: 2, negativeMarks: 0.5, options: [], answerKey: { items: ['wake', 'wash', 'dress', 'leave'] } };
  assert.equal(markAuto({ ...base, response: [0, 1, 2, 3] }).marksAwarded, 2);
  assert.equal(markAuto({ ...base, response: [0, 2, 1, 3] }).marksAwarded, -0.5);
  assert.equal(markAuto({ ...base, response: [] }).isCorrect, null);
});

test('a human-marked answer only says whether it was given', () => {
  assert.equal(isAnswered('FILE_UPLOAD', { assetId: 'x', fileName: 'a.pdf' }), true);
  assert.equal(isAnswered('FILE_UPLOAD', { fileName: 'a.pdf' }), false);
  assert.equal(isAnswered('SPEAKING', { assetId: 'x', durationSeconds: 40 }), true);
  assert.equal(isAnswered('LONG_ANSWER', '   '), false);
});

test('the display order is stable for one attempt and never the answer itself', () => {
  const a = displayOrder(4, 'attempt-1');
  assert.deepEqual(a, displayOrder(4, 'attempt-1'));
  assert.notDeepEqual(a, [0, 1, 2, 3]);
  assert.deepEqual([...a].sort(), [0, 1, 2, 3]);
  assert.notDeepEqual(displayOrder(2, 'x'), [0, 1]);
});

test('a timed section is not started, open, then closed by arithmetic', () => {
  const now = new Date('2026-09-12T10:00:00Z');
  assert.equal(sectionState({ id: 's', durationMinutes: null, startedAt: null }, now), 'OPEN');
  assert.equal(sectionState({ id: 's', durationMinutes: 30, startedAt: null }, now), 'NOT_STARTED');
  assert.equal(sectionState({ id: 's', durationMinutes: 30, startedAt: new Date('2026-09-12T09:45:00Z') }, now), 'OPEN');
  assert.equal(sectionState({ id: 's', durationMinutes: 30, startedAt: new Date('2026-09-12T09:30:00Z') }, now), 'CLOSED');
  const clock = readSectionClock({ s1: '2026-09-12T09:45:00Z', s2: 'garbage', s3: 5 });
  assert.deepEqual(Object.keys(clock), ['s1']);
});
