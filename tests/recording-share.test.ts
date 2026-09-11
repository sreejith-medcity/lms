import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRemaining, expiryFromDays, shareVerdict, type ShareRecord } from '../src/lib/recording-share';

const NOW = new Date('2026-09-11T10:00:00Z');

function share(over: Partial<ShareRecord> = {}): ShareRecord {
  return {
    userId: 'learner-1',
    expiresAt: new Date('2026-09-13T18:29:59Z'),
    maxViews: null,
    viewCount: 0,
    revokedAt: null,
    createdAt: new Date('2026-09-11T09:00:00Z'),
    ...over,
  };
}

test('the learner it was made for can watch it', () => {
  const verdict = shareVerdict(share(), 'learner-1', NOW);
  assert.equal(verdict.ok, true);
});

test('a forwarded link does not work for somebody else', () => {
  const verdict = shareVerdict(share(), 'learner-2', NOW);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.reason, 'WRONG_LEARNER');
});

test('a stranger with the link is asked to sign in, not let in', () => {
  const verdict = shareVerdict(share(), null, NOW);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.reason, 'SIGN_IN');
});

test('it stops working on its date', () => {
  const expired = shareVerdict(share({ expiresAt: new Date('2026-09-11T09:59:59Z') }), 'learner-1', NOW);
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, 'EXPIRED');
});

test('the exact moment of expiry is closed, not open', () => {
  const verdict = shareVerdict(share({ expiresAt: NOW }), 'learner-1', NOW);
  assert.equal(verdict.ok, false);
});

test('withdrawing it beats everything else', () => {
  const verdict = shareVerdict(share({ revokedAt: new Date('2026-09-11T09:30:00Z') }), 'learner-1', NOW);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.reason, 'REVOKED');
});

test('a view limit is counted, and what is left is reported', () => {
  const first = shareVerdict(share({ maxViews: 3, viewCount: 1 }), 'learner-1', NOW);
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.viewsLeft, 2);

  const spent = shareVerdict(share({ maxViews: 3, viewCount: 3 }), 'learner-1', NOW);
  assert.equal(spent.ok, false);
  if (!spent.ok) assert.equal(spent.reason, 'EXHAUSTED');
});

test('the wrong learner is told that, rather than being told it is used up', () => {
  // Otherwise the refusal doubles as a hint that the link is real and live.
  const verdict = shareVerdict(share({ maxViews: 1, viewCount: 1 }), 'learner-2', NOW);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.reason, 'WRONG_LEARNER');
});

test('two days means the end of the second day, not this time in two days', () => {
  const from = new Date('2026-09-11T21:30:00');
  const end = expiryFromDays(2, from);
  assert.equal(end.getDate(), 13);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
});

test('a nonsense number of days is brought back into range', () => {
  const from = new Date('2026-09-11T10:00:00');
  assert.equal(expiryFromDays(0, from).getDate(), 12);
  assert.equal(expiryFromDays(-4, from).getDate(), 12);
  assert.ok(expiryFromDays(9999, from).getTime() - from.getTime() <= 366 * 864e5);
});

test('the time left reads as a person would say it', () => {
  const base = new Date('2026-09-11T10:00:00Z');
  assert.equal(describeRemaining(new Date('2026-09-11T09:00:00Z'), base), 'expired');
  assert.equal(describeRemaining(new Date('2026-09-11T10:30:00Z'), base), 'less than an hour left');
  assert.equal(describeRemaining(new Date('2026-09-11T15:00:00Z'), base), '5 hours left');
  assert.equal(describeRemaining(new Date('2026-09-13T10:00:00Z'), base), '2 days left');
});
