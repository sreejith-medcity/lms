import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEngine, memberRef, LOYALTY_EVENTS } from '../src/lib/loyalty-contract';

/**
 * Two loyalty engines exist now: the wallet built into this product, and the
 * separate platform. The one rule that matters is that they are never both
 * awarding, because a learner earning twice for one purchase is found by the
 * learner, counting.
 */

test('only the three real answers are engines', () => {
  assert.equal(isEngine('built-in'), true);
  assert.equal(isEngine('external'), true);
  assert.equal(isEngine('off'), true);

  // Anything else must fall back to the default rather than being honoured.
  assert.equal(isEngine('externals'), false);
  assert.equal(isEngine('BUILT-IN'), false);
  assert.equal(isEngine(''), false);
  assert.equal(isEngine(null), false);
  assert.equal(isEngine(undefined), false);
  assert.equal(isEngine(1), false);
});

test('a member reference carries what the other side matches on', () => {
  const ref = memberRef({ id: 'u1', email: 'A@Example.com', phone: '9847012345', name: 'Sree' });

  // The internal id travels too, so a member survives an email change rather
  // than losing their balance.
  assert.equal(ref.userId, 'u1');
  assert.equal(ref.email, 'A@Example.com');
  assert.equal(ref.phone, '9847012345');
  assert.equal(ref.name, 'Sree');
});

test('a member with no email still produces a reference', () => {
  // Plenty of learners here sign up with a phone number and nothing else.
  const ref = memberRef({ id: 'u2', email: null, phone: '9847012345', name: 'Anu' });
  assert.equal(ref.email, null);
  assert.equal(ref.phone, '9847012345');
});

test('the earn event names are fixed, because the other side subscribes to them', () => {
  assert.deepEqual(LOYALTY_EVENTS, {
    enrolled: 'enrolment.created',
    paid: 'payment.captured',
    attended: 'attendance.recorded',
    completed: 'course.completed',
    refunded: 'payment.refunded',
  });
});
