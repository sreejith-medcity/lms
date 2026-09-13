import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustmentProblem, computePayout, hoursLabel, monthWindow, recentMonthKeys, sessionMinutes } from '../src/lib/payouts';

const TZ = 'Asia/Calcutta';
const line = (minutes: number, i: number) => ({ sessionId: `s${i}`, title: `Class ${i}`, startsAt: '2026-09-01T13:30:00.000Z', minutes, batch: 'B1', oneToOne: false });

test('minutes come from the schedule, never negative', () => {
  assert.equal(sessionMinutes(new Date('2026-09-01T13:30:00Z'), new Date('2026-09-01T14:45:00Z')), 75);
  assert.equal(sessionMinutes(new Date('2026-09-01T14:45:00Z'), new Date('2026-09-01T13:30:00Z')), 0);
});

test('hourly pay is minutes at the rate; a per-class rate wins when set', () => {
  const lines = [line(60, 1), line(90, 2), line(45, 3)];
  assert.deepEqual(computePayout(lines, { hourlyRatePaise: 80_000, perSessionPaise: null }), { sessions: 3, minutes: 195, ratePaise: 80_000, rateBasis: 'HOUR', earnedPaise: 260_000 });
  assert.deepEqual(computePayout(lines, { hourlyRatePaise: 80_000, perSessionPaise: 100_000 }), { sessions: 3, minutes: 195, ratePaise: 100_000, rateBasis: 'SESSION', earnedPaise: 300_000 });
  assert.equal(computePayout([], { hourlyRatePaise: null, perSessionPaise: null }).earnedPaise, 0);
});

test('a month is the academy month, first instant to the next first', () => {
  const w = monthWindow('2026-09', TZ)!;
  assert.equal(w.from.toISOString(), '2026-08-31T18:30:00.000Z');
  assert.equal(w.to.toISOString(), '2026-09-30T18:30:00.000Z');
  assert.equal(w.label, 'September 2026');
  assert.equal(monthWindow('2026-9', TZ), null);
  assert.deepEqual(recentMonthKeys(new Date('2026-09-13T04:00:00Z'), TZ, 3), ['2026-09', '2026-08', '2026-07']);
});

test('adjustments need a reason, and hours read plainly', () => {
  assert.equal(adjustmentProblem(0, ''), null);
  assert.equal(adjustmentProblem(50_000, ''), 'Say what the adjustment is for.');
  assert.equal(adjustmentProblem(-50_000, 'Missed the Tuesday class'), null);
  assert.equal(hoursLabel(195), '3h 15m');
  assert.equal(hoursLabel(120), '2h');
  assert.equal(hoursLabel(40), '40m');
});
