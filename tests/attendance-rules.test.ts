import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertKey, alerts, canCorrect, correctionNotice, onlineNoShows, parentLine, reviewRegister, statusForJoin, unrecordedState } from '../src/lib/attendance-rules';

test('a join after the threshold is late; on the threshold it is on time', () => {
  assert.equal(statusForJoin(10, 10), 'PRESENT');
  assert.equal(statusForJoin(11, 10), 'LATE');
  assert.equal(statusForJoin(0, 0), 'PRESENT');
  assert.equal(statusForJoin(1, 0), 'LATE');
});

test('the review counts what is marked and names who is not; nobody unmarked becomes absent', () => {
  const roster = [
    { userId: 'a', name: 'Anjali', recorded: null },
    { userId: 'b', name: 'Biju', recorded: 'PRESENT' as const },
    { userId: 'c', name: 'Chitra', recorded: null },
    { userId: 'd', name: 'Deepak', recorded: null },
  ];
  const r = reviewRegister(roster, { a: 'ABSENT', c: 'LATE' });
  assert.equal(r.present, 1);
  assert.equal(r.absent, 1);
  assert.equal(r.late, 1);
  assert.deepEqual(r.unmarked, ['Deepak']);
  assert.equal(r.total, 4);
  // A draft mark overrides what is recorded, and clearing it falls back.
  assert.equal(reviewRegister(roster, { b: 'ABSENT' }).absent, 1);
  assert.equal(reviewRegister(roster, {}).present, 1);
});

test('parents are told about absent and late, and a correction follows an alert that changed', () => {
  assert.equal(alerts('ABSENT'), true);
  assert.equal(alerts('LATE'), true);
  assert.equal(alerts('PRESENT'), false);
  assert.equal(alerts(null), false);

  assert.equal(correctionNotice(null, 'ABSENT'), 'alert');
  assert.equal(correctionNotice(null, 'PRESENT'), 'none');
  assert.equal(correctionNotice('PRESENT', 'ABSENT'), 'alert');
  assert.equal(correctionNotice('ABSENT', 'PRESENT'), 'correction');
  assert.equal(correctionNotice('ABSENT', 'LATE'), 'correction');
  assert.equal(correctionNotice('ABSENT', 'ABSENT'), 'none');
  assert.equal(correctionNotice('PRESENT', 'EXCUSED'), 'none');
});

test('one key per learner, class and status, so a re-save cannot send twice', () => {
  assert.equal(alertKey('s1', 'u1', 'ABSENT'), 'attendance:s1:u1:ABSENT');
  assert.notEqual(alertKey('s1', 'u1', 'ABSENT'), alertKey('s1', 'u1', 'LATE'));
});

test('corrections stay open for the window, and always for the branch', () => {
  const start = new Date('2026-09-01T09:00:00Z');
  assert.equal(canCorrect(start, new Date('2026-09-05T09:00:00Z'), 7, false), true);
  assert.equal(canCorrect(start, new Date('2026-09-09T09:00:00Z'), 7, false), false);
  assert.equal(canCorrect(start, new Date('2026-10-09T09:00:00Z'), 7, true), true);
  assert.equal(canCorrect(start, new Date('2026-09-01T10:00:00Z'), 0, false), false);
});

test('online no-shows need a confirmed start and the check time; missing data marks nobody', () => {
  const startsAt = new Date('2026-09-18T10:00:00Z');
  const base = { startsAt, absentAfterMinutes: 20, unrecorded: ['a', 'b'] };
  assert.deepEqual(onlineNoShows({ ...base, confirmedStarted: false, now: new Date('2026-09-18T11:00:00Z') }), []);
  assert.deepEqual(onlineNoShows({ ...base, confirmedStarted: true, now: new Date('2026-09-18T10:19:00Z') }), []);
  assert.deepEqual(onlineNoShows({ ...base, confirmedStarted: true, now: new Date('2026-09-18T10:20:00Z') }), ['a', 'b']);
  assert.deepEqual(onlineNoShows({ ...base, confirmedStarted: true, now: new Date('2026-09-18T10:20:00Z'), unrecorded: [] }), []);
});

test('an unrecorded learner is described honestly by class mode and what the platform said', () => {
  assert.equal(unrecordedState({ mode: 'IN_PERSON', confirmedStarted: false, ended: true }), 'not recorded');
  assert.equal(unrecordedState({ mode: 'ONLINE', confirmedStarted: false, ended: false }), 'awaiting attendance data');
  assert.equal(unrecordedState({ mode: 'ONLINE', confirmedStarted: false, ended: true }), 'needs review');
  assert.equal(unrecordedState({ mode: 'HYBRID', confirmedStarted: true, ended: true }), 'needs review');
});

test('the parent line says who, what and when, and a correction says what was said before', () => {
  const a = parentLine({ learner: 'Anjali', status: 'ABSENT', title: 'German A1', when: 'Thu 18 Sep at 10:00' });
  assert.match(a.title, /Anjali was absent/);
  assert.match(a.body, /was absent from German A1 on Thu 18 Sep at 10:00/);
  const c = parentLine({ learner: 'Anjali', status: 'PRESENT', title: 'German A1', when: 'Thu 18 Sep at 10:00', corrected: { from: 'ABSENT' } });
  assert.match(c.title, /^Correction:/);
  assert.match(c.body, /Earlier we said Anjali was absent/);
  assert.match(c.body, /Anjali was present at the class/);
});
