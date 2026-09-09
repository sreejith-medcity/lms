import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, dayStart, dayEnd, addDays, minutesOfDay } from '../src/lib/clock';

/**
 * A 7pm class in Kochi belongs to that Tuesday whether the server is in Mumbai,
 * London or UTC. Every one of these would pass by accident if the tests ran in
 * Asia/Calcutta, so they all name a timezone explicitly.
 */

const KOCHI = 'Asia/Calcutta';

test('an evening class in Kochi belongs to the Kochi day, not the UTC one', () => {
  // 19:00 IST on 10 September is 13:30 UTC the same day; 00:30 IST on the 11th
  // is 19:00 UTC on the 10th, and that one is the trap.
  const lateClass = new Date('2026-09-10T19:00:00+05:30');
  assert.equal(dayKey(lateClass, KOCHI), '2026-09-10');

  const afterMidnight = new Date('2026-09-11T00:30:00+05:30');
  assert.equal(dayKey(afterMidnight, KOCHI), '2026-09-11');
  assert.equal(dayKey(afterMidnight, 'UTC'), '2026-09-10');
});

test('a day runs from local midnight to the next, exclusive at the top', () => {
  const start = dayStart('2026-09-10', KOCHI);
  const end = dayEnd('2026-09-10', KOCHI);

  assert.equal(dayKey(start, KOCHI), '2026-09-10');
  assert.ok(start < end);

  // dayEnd is the next midnight, not the last instant of the day. That is the
  // contract every caller relies on, because they all query `lt: to`. A class
  // at 23:59 is inside the range; one at exactly midnight belongs to the 11th.
  assert.equal(dayKey(end, KOCHI), '2026-09-11');

  const lastMinute = new Date('2026-09-10T23:59:00+05:30');
  assert.ok(lastMinute >= start && lastMinute < end);

  const nextMidnight = new Date('2026-09-11T00:00:00+05:30');
  assert.ok(nextMidnight >= end, 'midnight must fall outside the day it ends');
});

test('a day is exactly 24 hours where there is no DST, and never zero', () => {
  const start = dayStart('2026-09-10', KOCHI);
  const end = dayEnd('2026-09-10', KOCHI);
  assert.equal(end.getTime() - start.getTime(), 86_400_000);
});

test('adding days does not drift across a month or a leap year', () => {
  assert.equal(addDays('2026-09-10', 7), '2026-09-17');
  assert.equal(addDays('2026-02-26', 3), '2026-03-01');
  assert.equal(addDays('2028-02-27', 2), '2028-02-29');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('minutes of day are read in the academy timezone', () => {
  assert.equal(minutesOfDay(new Date('2026-09-10T19:00:00+05:30'), KOCHI), 19 * 60);
  assert.equal(minutesOfDay(new Date('2026-09-10T00:00:00+05:30'), KOCHI), 0);
});
