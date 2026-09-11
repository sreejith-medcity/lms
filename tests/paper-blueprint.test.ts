import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availability,
  drawPaper,
  matches,
  parseBlueprint,
  seededRandom,
  type PoolQuestion,
} from '../src/lib/paper-blueprint';

const q = (id: string, tags: string[], difficulty: PoolQuestion['difficulty'] = 'MEDIUM', bankId = 'b1'): PoolQuestion => ({
  id,
  bankId,
  tags,
  difficulty,
  type: 'MCQ_SINGLE',
  marks: 1,
});

const pool = [
  q('1', ['ecg', 'cardio'], 'HARD'),
  q('2', ['ecg', 'cardio'], 'EASY'),
  q('3', ['cardio']),
  q('4', ['pharma']),
  q('5', ['pharma'], 'HARD', 'b2'),
  q('6', [], 'MEDIUM', 'b2'),
];

test('matching: every tag by default, any tag when asked, plus bank, difficulty and type', () => {
  assert.equal(matches(pool[0], { label: '', count: 1, tags: ['ECG', 'cardio'] }), true);
  assert.equal(matches(pool[2], { label: '', count: 1, tags: ['ecg', 'cardio'] }), false);
  assert.equal(matches(pool[2], { label: '', count: 1, tags: ['ecg', 'cardio'], anyTag: true }), true);
  assert.equal(matches(pool[0], { label: '', count: 1, difficulty: 'EASY' }), false);
  assert.equal(matches(pool[4], { label: '', count: 1, bankIds: ['b1'] }), false);
  assert.equal(matches(pool[4], { label: '', count: 1, types: ['LONG_ANSWER'] }), false);
  assert.equal(matches(pool[5], { label: '', count: 1 }), true);
});

test('availability counts per section, ignoring overlap', () => {
  assert.deepEqual(
    availability(pool, [
      { label: 'a', count: 5, tags: ['cardio'] },
      { label: 'b', count: 5, difficulty: 'HARD' },
      { label: 'c', count: 5 },
    ]),
    [3, 2, 6],
  );
});

test('a draw never repeats a question and fills the tight section first', () => {
  const draw = drawPaper(
    pool,
    [
      { label: 'anything', count: 4 },
      { label: 'ecg', count: 2, tags: ['ecg'] },
    ],
    seededRandom(7),
  );
  assert.equal(draw.picks.length, 6);
  assert.equal(new Set(draw.picks.map((p) => p.questionId)).size, 6);
  const ecg = draw.picks.filter((p) => p.section === 1).map((p) => p.questionId).sort();
  assert.deepEqual(ecg, ['1', '2']);
  assert.deepEqual(draw.shortfalls, []);
  assert.equal(draw.totalMarks, 6);
});

test('a section the bank cannot fill is reported, not padded', () => {
  const draw = drawPaper(pool, [{ label: 'pharma hard', count: 3, tags: ['pharma'], difficulty: 'HARD' }], seededRandom(1));
  assert.deepEqual(draw.shortfalls, [{ section: 0, wanted: 3, drawn: 1 }]);
  assert.deepEqual(draw.picks, [{ section: 0, questionId: '5' }]);
});

test('the same seed draws the same paper', () => {
  const a = drawPaper(pool, [{ label: 'x', count: 3 }], seededRandom(42));
  const b = drawPaper(pool, [{ label: 'x', count: 3 }], seededRandom(42));
  assert.deepEqual(a.picks, b.picks);
});

test('a stored blueprint is read back defensively', () => {
  assert.deepEqual(parseBlueprint(null), []);
  const parsed = parseBlueprint([
    { label: ' ECG ', count: '5', tags: ['ecg', ''], difficulty: 'HARD', anyTag: 1 },
    { count: 0 },
    { count: 2, difficulty: 'IMPOSSIBLE' },
    'junk',
  ]);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { label: 'ECG', count: 5, bankIds: [], tags: ['ecg'], anyTag: true, difficulty: 'HARD', types: [] });
  assert.equal(parsed[1].label, 'Section 2');
  assert.equal(parsed[1].difficulty, null);
});
