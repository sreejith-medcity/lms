import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeProblem, feeDaysOverdue, feeProblem, feeStatusLabel, summariseFees } from '../src/lib/misc-fees';

const now = new Date('2026-09-12T06:00:00Z');
const day = (offset: number) => new Date(now.getTime() + offset * 864e5);

test('a fee needs a label and a positive amount', () => {
  assert.equal(feeProblem({ label: 'Exam fee', amountPaise: 50_000 }), null);
  assert.equal(feeProblem({ label: '', amountPaise: 50_000 }), 'Say what the charge is for.');
  assert.equal(feeProblem({ label: 'Exam fee', amountPaise: 0 }), 'Enter an amount above zero.');
});

test('overdue counts only open fees with a date', () => {
  assert.equal(feeDaysOverdue({ dueDate: day(-3), status: 'PENDING' }, now), 3);
  assert.equal(feeDaysOverdue({ dueDate: day(-3), status: 'PAID' }, now), 0);
  assert.equal(feeDaysOverdue({ dueDate: null, status: 'PENDING' }, now), 0);
});

test('status reads plainly', () => {
  assert.deepEqual(feeStatusLabel({ amountPaise: 1, dueDate: day(-2), status: 'PENDING' }, now), { text: '2 days late', tone: 'bad' });
  assert.deepEqual(feeStatusLabel({ amountPaise: 1, dueDate: day(3), status: 'PENDING' }, now), { text: 'Due in 3 days', tone: 'warn' });
  assert.deepEqual(feeStatusLabel({ amountPaise: 1, dueDate: null, status: 'PENDING' }, now), { text: 'Open', tone: 'warn' });
  assert.deepEqual(feeStatusLabel({ amountPaise: 1, dueDate: null, status: 'PAID' }, now), { text: 'Paid', tone: 'ok' });
});

test('the summary separates open, overdue and paid', () => {
  const s = summariseFees(
    [
      { amountPaise: 50_000, dueDate: day(-5), status: 'PENDING' },
      { amountPaise: 20_000, dueDate: day(5), status: 'PENDING' },
      { amountPaise: 10_000, dueDate: null, status: 'PAID' },
      { amountPaise: 99_000, dueDate: null, status: 'WAIVED' },
    ],
    now,
  );
  assert.deepEqual(s, { openPaise: 70_000, openCount: 2, overduePaise: 50_000, paidPaise: 10_000 });
});

test('closed fees cannot be closed again', () => {
  assert.equal(closeProblem({ status: 'PENDING' }), null);
  assert.equal(closeProblem({ status: 'PAID' }), 'This fee is already paid.');
  assert.equal(closeProblem({ status: 'WAIVED' }), 'This fee was waived.');
});
