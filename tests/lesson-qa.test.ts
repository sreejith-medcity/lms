import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerProblem,
  askingCount,
  canWithdraw,
  learnerOrder,
  queueOrder,
  questionProblem,
  toTell,
  toggleAlsoAsking,
  visibleBatches,
  waitingLabel,
} from '../src/lib/lesson-qa';

const t = (iso: string) => new Date(iso);

function q(over: Partial<Parameters<typeof learnerOrder>[0][number]> & { id: string }) {
  return {
    userId: 'u1',
    batchId: null,
    isPinned: false,
    isHidden: false,
    answeredAt: null,
    alsoAsking: [] as string[],
    createdAt: t('2026-09-01T00:00:00Z'),
    ...over,
  };
}

test('a question needs a few words and stays within the limit', () => {
  assert.equal(questionProblem('   '), 'Write the question first.');
  assert.equal(questionProblem('Why?'), 'Give the trainer a little more to go on.');
  assert.equal(questionProblem('Why is the dative used here?'), null);
  assert.match(questionProblem('x'.repeat(2001)) ?? '', /under 2000/);
  assert.equal(answerProblem(''), 'Write the answer first.');
  assert.equal(answerProblem('Because the verb takes it.'), null);
});

test('a batch learner sees the course-wide questions and their batch; a self-paced one only the course-wide', () => {
  assert.deepEqual(visibleBatches('b1'), [null, 'b1']);
  assert.deepEqual(visibleBatches(null), [null]);
});

test('me too toggles on and off, and the asker never joins their own question', () => {
  assert.deepEqual(toggleAlsoAsking([], 'u2', 'u1'), ['u2']);
  assert.deepEqual(toggleAlsoAsking(['u2'], 'u2', 'u1'), []);
  assert.deepEqual(toggleAlsoAsking(['u2'], 'u1', 'u1'), ['u2']);
  assert.equal(askingCount({ alsoAsking: ['u2', 'u3'] }), 3);
});

test('the learner list puts pinned first, then unanswered, newest first inside each', () => {
  const rows = [
    q({ id: 'old-answered', answeredAt: t('2026-09-02T00:00:00Z'), createdAt: t('2026-08-01T00:00:00Z') }),
    q({ id: 'new', createdAt: t('2026-09-05T00:00:00Z') }),
    q({ id: 'pinned', isPinned: true, answeredAt: t('2026-09-02T00:00:00Z'), createdAt: t('2026-07-01T00:00:00Z') }),
    q({ id: 'older', createdAt: t('2026-09-03T00:00:00Z') }),
  ];
  assert.deepEqual(learnerOrder(rows).map((r) => r.id), ['pinned', 'new', 'older', 'old-answered']);
});

test('the queue puts the most-wanted unanswered question first, then the oldest, then answered newest', () => {
  const rows = [
    q({ id: 'answered-late', answeredAt: t('2026-09-09T00:00:00Z') }),
    q({ id: 'answered-early', answeredAt: t('2026-09-02T00:00:00Z') }),
    q({ id: 'lonely-old', createdAt: t('2026-08-01T00:00:00Z') }),
    q({ id: 'popular', alsoAsking: ['u2', 'u3'], createdAt: t('2026-09-05T00:00:00Z') }),
    q({ id: 'lonely-new', createdAt: t('2026-09-06T00:00:00Z') }),
  ];
  assert.deepEqual(queueOrder(rows).map((r) => r.id), ['popular', 'lonely-old', 'lonely-new', 'answered-late', 'answered-early']);
});

test('only the asker withdraws, and only before an answer', () => {
  assert.equal(canWithdraw({ userId: 'u1', answeredAt: null }, 'u1'), true);
  assert.equal(canWithdraw({ userId: 'u1', answeredAt: null }, 'u2'), false);
  assert.equal(canWithdraw({ userId: 'u1', answeredAt: t('2026-09-02T00:00:00Z') }, 'u1'), false);
});

test('everyone waiting is told once', () => {
  assert.deepEqual(toTell({ userId: 'u1', alsoAsking: ['u2', 'u1', 'u3', 'u2'] }), ['u1', 'u2', 'u3']);
  assert.equal(waitingLabel(0), 'Nothing waiting');
  assert.equal(waitingLabel(1), '1 question waiting');
  assert.equal(waitingLabel(4), '4 questions waiting');
});
