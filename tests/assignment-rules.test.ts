import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueLabel, gradeProblem, handInDecision, handInProblem, handInTally, learnerStanding, marksPercent } from '../src/lib/assignment-rules';

const now = new Date('2026-09-12T10:00:00Z');
const tomorrow = new Date('2026-09-13T10:00:00Z');
const yesterday = new Date('2026-09-11T10:00:00Z');

const base = { status: 'PUBLISHED' as const, dueAt: tomorrow, acceptLate: true, allowResubmit: true, requireText: false, requireFile: false, maxMarks: 100 };

test('a published assignment before its due date takes a first hand-in', () => {
  const d = handInDecision(base, [], now);
  assert.deepEqual(d, { allowed: true, attemptNo: 1, late: false, again: false });
});

test('a draft or archived assignment takes nothing', () => {
  assert.equal(handInDecision({ ...base, status: 'DRAFT' }, [], now).allowed, false);
  assert.equal(handInDecision({ ...base, status: 'ARCHIVED' }, [], now).allowed, false);
});

test('after the due date: late when accepted, refused when not', () => {
  const late = handInDecision({ ...base, dueAt: yesterday }, [], now);
  assert.deepEqual(late, { allowed: true, attemptNo: 1, late: true, again: false });
  const refused = handInDecision({ ...base, dueAt: yesterday, acceptLate: false }, [], now);
  assert.equal(refused.allowed, false);
});

test('a second hand-in gets the next attempt number, or is refused', () => {
  const prior = [{ attemptNo: 1, status: 'GRADED' as const }];
  const again = handInDecision(base, prior, now);
  assert.deepEqual(again, { allowed: true, attemptNo: 2, late: false, again: true });
  const once = handInDecision({ ...base, allowResubmit: false }, prior, now);
  assert.equal(once.allowed, false);
});

test('a hand-in waiting to be marked blocks another only when resubmission is off', () => {
  const prior = [{ attemptNo: 1, status: 'SUBMITTED' as const }];
  assert.equal(handInDecision(base, prior, now).allowed, true);
  assert.equal(handInDecision({ ...base, allowResubmit: false }, prior, now).allowed, false);
});

test('a returned piece may always be handed in again, even where resubmission is off', () => {
  // Returning it is the trainer asking for another go; refusing that go would be absurd.
  const prior = [{ attemptNo: 1, status: 'RETURNED' as const }];
  const d = handInDecision({ ...base, allowResubmit: false }, prior, now);
  assert.equal(d.allowed, true);
  if (d.allowed) assert.equal(d.attemptNo, 2);
});

test('what the brief asks for is what the hand-in must carry', () => {
  assert.equal(handInProblem(base, { text: '', fileCount: 0 }), 'Write something or attach a file before handing in.');
  assert.equal(handInProblem({ requireText: true, requireFile: false }, { text: '  ', fileCount: 2 }), 'This assignment asks for a written answer.');
  assert.equal(handInProblem({ requireText: false, requireFile: true }, { text: 'here', fileCount: 0 }), 'This assignment asks for a file.');
  assert.equal(handInProblem({ requireText: true, requireFile: true }, { text: 'here', fileCount: 1 }), null);
});

test('marks stay inside the total', () => {
  assert.equal(gradeProblem(null, 100), 'Enter a mark.');
  assert.equal(gradeProblem(-1, 100), 'A mark cannot be negative.');
  assert.equal(gradeProblem(101, 100), 'The most this assignment is out of is 100.');
  assert.equal(gradeProblem(7.5, 10), null);
  assert.equal(marksPercent(7.5, 10), 75);
  assert.equal(marksPercent(1, 3), 33.3);
});

test('due labels', () => {
  assert.equal(dueLabel(null, now), 'No due date');
  assert.equal(dueLabel(new Date('2026-09-12T10:30:00Z'), now), 'Due within the hour');
  assert.equal(dueLabel(new Date('2026-09-12T15:00:00Z'), now), 'Due in 5 hours');
  assert.equal(dueLabel(tomorrow, now), 'Due in 1 day');
  assert.equal(dueLabel(new Date('2026-09-20T10:00:00Z'), now), 'Due in 8 days');
  assert.equal(dueLabel(new Date('2026-09-12T08:00:00Z'), now), 'Overdue since today');
  assert.equal(dueLabel(new Date('2026-09-09T10:00:00Z'), now), 'Overdue by 3 days');
});

test('the learner standing follows the latest attempt', () => {
  assert.equal(learnerStanding(base, [], now), 'NOT_STARTED');
  assert.equal(learnerStanding(base, [{ attemptNo: 1, status: 'SUBMITTED' }], now), 'WAITING');
  assert.equal(learnerStanding(base, [{ attemptNo: 1, status: 'GRADED' }, { attemptNo: 2, status: 'SUBMITTED' }], now), 'WAITING');
  assert.equal(learnerStanding(base, [{ attemptNo: 2, status: 'GRADED' }, { attemptNo: 1, status: 'RETURNED' }], now), 'GRADED');
  assert.equal(learnerStanding({ ...base, dueAt: yesterday, acceptLate: false }, [], now), 'CLOSED');
});

test('the tally counts each learner once, by their latest attempt', () => {
  const tally = handInTally(
    [
      { userId: 'a', attemptNo: 1, status: 'GRADED' },
      { userId: 'a', attemptNo: 2, status: 'SUBMITTED' },
      { userId: 'b', attemptNo: 1, status: 'GRADED' },
      { userId: 'c', attemptNo: 1, status: 'RETURNED' },
    ],
    6,
  );
  assert.deepEqual(tally, { handedIn: 3, toMark: 1, graded: 1, returned: 1, missing: 3 });
});
