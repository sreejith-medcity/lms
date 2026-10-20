import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLDS_SEAT, ON_ROLL, firstWithRoom, hasRoom, seatsLeftLabel } from '../src/lib/seats';

test('a cancelled or archived place neither holds a seat nor sits on the roll', () => {
  assert.deepEqual(HOLDS_SEAT.status.notIn, ['CANCELLED', 'ARCHIVED']);
  assert.ok(!ON_ROLL.status.in.includes('CANCELLED' as never));
  assert.ok(!ON_ROLL.status.in.includes('ON_LEAVE' as never));
});

test('a batch without a cap always has room', () => {
  assert.equal(hasRoom({ id: 'a', capacity: null, taken: 500 }), true);
  assert.equal(hasRoom({ id: 'a', capacity: 0, taken: 500 }), true);
  assert.equal(hasRoom({ id: 'a', capacity: 10, taken: 9 }), true);
  assert.equal(hasRoom({ id: 'a', capacity: 10, taken: 10 }), false);
});

test('the default batch is skipped once it is full, and nothing is picked when all are', () => {
  const full = { id: 'default', capacity: 2, taken: 2 };
  const next = { id: 'next', capacity: 20, taken: 3 };
  assert.equal(firstWithRoom([full, next])?.id, 'next');
  assert.equal(firstWithRoom([next, full])?.id, 'next');
  assert.equal(firstWithRoom([full]), null);
  assert.equal(firstWithRoom([]), null);
});

test('seats left reads naturally', () => {
  assert.equal(seatsLeftLabel({ id: 'a', capacity: null, taken: 4 }), null);
  assert.equal(seatsLeftLabel({ id: 'a', capacity: 5, taken: 4 }), '1 seat left');
  assert.equal(seatsLeftLabel({ id: 'a', capacity: 5, taken: 2 }), '3 seats left');
  assert.equal(seatsLeftLabel({ id: 'a', capacity: 5, taken: 7 }), 'full');
});
