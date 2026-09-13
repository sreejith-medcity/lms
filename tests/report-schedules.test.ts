import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCadence, fileNameFor, nextRun, parseRecipients, windowFor } from '../src/lib/report-schedules';

const TZ = 'Asia/Calcutta';
// Saturday 12 September 2026, 10:00 IST.
const from = new Date('2026-09-12T04:30:00Z');

test('daily: today at the hour if still ahead, otherwise tomorrow', () => {
  assert.equal(nextRun({ cadence: 'DAILY', dayOfWeek: 1, dayOfMonth: 1, hourLocal: 18 }, from, TZ).toISOString(), '2026-09-12T12:30:00.000Z');
  assert.equal(nextRun({ cadence: 'DAILY', dayOfWeek: 1, dayOfMonth: 1, hourLocal: 8 }, from, TZ).toISOString(), '2026-09-13T02:30:00.000Z');
});

test('weekly: the next Monday at 8 on the academy clock', () => {
  const at = nextRun({ cadence: 'WEEKLY', dayOfWeek: 1, dayOfMonth: 1, hourLocal: 8 }, from, TZ);
  assert.equal(at.toISOString(), '2026-09-14T02:30:00.000Z');
  // Asked on that Monday at 9, it is the Monday after.
  const later = nextRun({ cadence: 'WEEKLY', dayOfWeek: 1, dayOfMonth: 1, hourLocal: 8 }, new Date('2026-09-14T03:30:00Z'), TZ);
  assert.equal(later.toISOString(), '2026-09-21T02:30:00.000Z');
});

test('monthly: the first of next month, and the 28th is the latest day allowed', () => {
  assert.equal(nextRun({ cadence: 'MONTHLY', dayOfWeek: 1, dayOfMonth: 1, hourLocal: 9 }, from, TZ).toISOString(), '2026-10-01T03:30:00.000Z');
  assert.equal(nextRun({ cadence: 'MONTHLY', dayOfWeek: 1, dayOfMonth: 31, hourLocal: 9 }, from, TZ).toISOString(), '2026-09-28T03:30:00.000Z');
});

test('cadences read plainly', () => {
  assert.equal(describeCadence({ cadence: 'DAILY', dayOfWeek: 1, dayOfMonth: 1, hourLocal: 8 }), 'Every day at 8am');
  assert.equal(describeCadence({ cadence: 'WEEKLY', dayOfWeek: 5, dayOfMonth: 1, hourLocal: 18 }), 'Every Friday at 6pm');
  assert.equal(describeCadence({ cadence: 'MONTHLY', dayOfWeek: 1, dayOfMonth: 2, hourLocal: 0 }), 'On the 2nd of every month at 12am');
});

test('recipients are cleaned and the bad ones named', () => {
  const r = parseRecipients('head@medcity.in, Head@Medcity.in\nnot-an-email; ops@medcity.in');
  assert.deepEqual(r.emails, ['head@medcity.in', 'ops@medcity.in']);
  assert.deepEqual(r.problems, ['not-an-email']);
});

test('the window is floored to the academy day and the file is dated', () => {
  const w = windowFor(7, from, TZ);
  assert.equal(w.days, 7);
  assert.equal(w.since.toISOString(), '2026-09-05T18:30:00.000Z');
  assert.equal(windowFor(12, from, TZ).days, 30);
  assert.equal(fileNameFor('collections-by-course', from, TZ), 'collections-by-course-2026-09-12.csv');
});
