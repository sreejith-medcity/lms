import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRESH, buildQueue, cardProblem, dueLabel, parseFlashcards, schedule, standing } from '../src/lib/revision';

const now = new Date('2026-09-13T10:00:00Z');
const days = (d: Date) => Math.round((d.getTime() - now.getTime()) / 86_400_000);

test('a card remembered gets a longer gap each time; an easy one longer still', () => {
  const first = schedule(FRESH, 2, now);
  assert.equal(days(first.due), 1);
  const second = schedule(first, 2, now);
  assert.equal(days(second.due), 6);
  const third = schedule(second, 2, now);
  assert.equal(days(third.due), 15);
  const easy = schedule(FRESH, 3, now);
  assert.equal(days(easy.due), 4);
  assert.ok(easy.ease > FRESH.ease);
});

test('a card forgotten goes back to the start, loses ease, and comes back in ten minutes', () => {
  const learned = schedule(schedule(schedule(FRESH, 2, now), 2, now), 2, now);
  const again = schedule(learned, 0, now);
  assert.equal(again.reps, 0);
  assert.equal(again.intervalDays, 0);
  assert.equal(again.lapses, 1);
  assert.ok(again.ease < learned.ease);
  assert.equal(again.due.getTime() - now.getTime(), 10 * 60_000);
});

test('hard grows slowly and ease never falls below the floor or above the ceiling', () => {
  let s = { ...FRESH, ease: 1.35 };
  for (let i = 0; i < 5; i += 1) s = schedule(s, 1, now);
  assert.equal(s.ease, 1.3);
  let e = { ...FRESH, ease: 2.95 };
  for (let i = 0; i < 5; i += 1) e = schedule(e, 3, now);
  assert.equal(e.ease, 3.0);
  assert.ok(e.intervalDays <= 365);
});

test('the queue is due cards oldest first, then a few new ones, capped', () => {
  const cards = [
    { id: 'new1', due: null, reps: 0 },
    { id: 'due-late', due: new Date('2026-09-13T09:00:00Z'), reps: 2 },
    { id: 'due-early', due: new Date('2026-09-10T09:00:00Z'), reps: 3 },
    { id: 'future', due: new Date('2026-09-20T09:00:00Z'), reps: 1 },
    { id: 'new2', due: null, reps: 0 },
    { id: 'new3', due: null, reps: 0 },
  ];
  assert.deepEqual(buildQueue(cards, now, { newPerSession: 2 }).map((c) => c.id), ['due-early', 'due-late', 'new1', 'new2']);
  assert.deepEqual(buildQueue(cards, now, { limit: 1 }).map((c) => c.id), ['due-early']);
});

test('the standing counts due, new and known', () => {
  const s = standing(
    [
      { due: null, intervalDays: 0 },
      { due: new Date('2026-09-12T00:00:00Z'), intervalDays: 6 },
      { due: new Date('2026-10-12T00:00:00Z'), intervalDays: 30 },
    ],
    now,
  );
  assert.deepEqual(s, { total: 3, due: 1, fresh: 1, known: 1 });
  assert.equal(dueLabel(new Date('2026-09-14T10:00:00Z'), now), 'tomorrow');
  assert.equal(dueLabel(new Date('2026-09-20T10:00:00Z'), now), 'in 7 days');
  assert.equal(dueLabel(new Date('2026-12-13T10:00:00Z'), now), 'in 3 months');
});

test('a card needs both sides, and drafts are read with duplicates dropped', () => {
  assert.equal(cardProblem('', 'x'), 'Write the front of the card: the question or the word.');
  assert.equal(cardProblem('die Wohnung', ''), 'Write the back: the answer.');
  assert.equal(cardProblem('die Wohnung', 'the flat'), null);
  const cards = parseFlashcards('{"cards":[{"front":"die Wohnung","back":"the flat","hint":"where you live"},{"front":"DIE WOHNUNG","back":"again"},{"front":"","back":"x"},{"front":"gehen","back":"to go"}]}');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].hint, 'where you live');
  assert.equal(cards[1].hint, null);
});
