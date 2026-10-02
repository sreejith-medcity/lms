import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerMatches, instructorMinutes, isOneToOne, parseWindow } from '@/lib/hrsuite-feed';

test('the bearer token must match the shared secret', () => {
  assert.equal(bearerMatches('Bearer s3cret', 's3cret'), true);
  assert.equal(bearerMatches('bearer  s3cret ', 's3cret'), true);
  assert.equal(bearerMatches('Bearer wrong', 's3cret'), false);
  assert.equal(bearerMatches(null, 's3cret'), false);
  assert.equal(bearerMatches('Bearer s3cret', ''), false);
});

test('a window is two dates, in order, at most 62 days apart', () => {
  assert.equal(parseWindow('2026-10-01T00:00:00+05:30', '2026-11-01T00:00:00+05:30').ok, true);
  assert.equal(parseWindow('2026-11-01', '2026-10-01').ok, false);
  assert.equal(parseWindow('2026-01-01', '2026-06-01').ok, false);
  assert.equal(parseWindow(null, '2026-10-01').ok, false);
});

test("a tutor's minutes from their own attendance row", () => {
  assert.equal(instructorMinutes(undefined), null);
  assert.equal(instructorMinutes({ joinedAt: null, leftAt: null, minutesPresent: 55 }), 55);
  assert.equal(instructorMinutes({ joinedAt: new Date('2026-10-05T10:00:00Z'), leftAt: new Date('2026-10-05T10:48:00Z'), minutesPresent: 0 }), 48);
});

test("one to one is a class booked for one learner, or an online tutor's group of one", () => {
  assert.equal(isOneToOne({ learnerId: 'u1' }, undefined), true);
  assert.equal(isOneToOne({ learnerId: null }, 1), true);
  assert.equal(isOneToOne({ learnerId: null }, 4), false);
  assert.equal(isOneToOne({ learnerId: null }, undefined), false);
});
