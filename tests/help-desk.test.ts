import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryLabel, isCategory, replyProblem, statusAfterMessage, ticketProblem, waitingDays, waitingLabel } from '../src/lib/help-desk';

test('a ticket needs a subject and enough of a body', () => {
  assert.equal(ticketProblem({ subject: 'Receipt missing', body: 'I paid on Monday at the counter and have no receipt.' }), null);
  assert.equal(ticketProblem({ subject: 'Hi', body: 'I paid on Monday at the counter and have no receipt.' }), 'Give it a subject.');
  assert.equal(ticketProblem({ subject: 'Receipt', body: 'help' }), 'Say a little more, so the office can help without asking.');
  assert.equal(replyProblem('   '), 'Write something first.');
});

test('categories are known and labelled', () => {
  assert.equal(isCategory('FEES'), true);
  assert.equal(isCategory('PIZZA'), false);
  assert.equal(categoryLabel('CLASSES'), 'Classes and schedule');
  assert.equal(categoryLabel('PIZZA'), 'Something else');
});

test('a message hands the ticket to the other side', () => {
  assert.equal(statusAfterMessage('RESOLVED', false), 'OPEN');
  assert.equal(statusAfterMessage('OPEN', true), 'WAITING_ON_LEARNER');
  assert.equal(statusAfterMessage('OPEN', true, true), 'RESOLVED');
});

test('waiting is counted only while the office owes a reply', () => {
  const now = new Date('2026-09-13T10:00:00Z');
  assert.equal(waitingDays(new Date('2026-09-10T09:00:00Z'), 'OPEN', now), 3);
  assert.equal(waitingDays(new Date('2026-09-10T09:00:00Z'), 'WAITING_ON_LEARNER', now), 0);
  assert.equal(waitingLabel(0), 'today');
  assert.equal(waitingLabel(1), 'a day');
  assert.equal(waitingLabel(4), '4 days');
});
