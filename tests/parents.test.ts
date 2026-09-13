import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attendanceNote, contactProblem, maskContact, normaliseContact, summariseAttendance, summariseMarks } from '../src/lib/parents';

test('a contact becomes ten digits or a lowercased email, or nothing', () => {
  assert.equal(normaliseContact('+91 98470 12345'), '9847012345');
  assert.equal(normaliseContact('  Amma@Example.COM '), 'amma@example.com');
  assert.equal(normaliseContact('12345'), '');
  assert.equal(normaliseContact('not an email@'), '');
  assert.equal(contactProblem(''), 'Enter the mobile number or email the academy has for you.');
  assert.equal(contactProblem('98470 12345'), null);
});

test('masking never prints the whole contact', () => {
  assert.equal(maskContact('9847012345'), 'the number ending 2345');
  assert.equal(maskContact('amma@example.com'), 'am**@example.com');
});

const d = (day: number) => new Date(Date.UTC(2026, 8, day));

test('attendance is counted without the excused, and a missed run is noticed', () => {
  const s = summariseAttendance([
    { status: 'PRESENT', startsAt: d(1) },
    { status: 'LATE', startsAt: d(2) },
    { status: 'EXCUSED', startsAt: d(3) },
    { status: 'ABSENT', startsAt: d(4) },
    { status: 'ABSENT', startsAt: d(5) },
    { status: 'EXCUSED', startsAt: d(6) },
    { status: 'ABSENT', startsAt: d(7) },
  ]);
  assert.equal(s.held, 7);
  assert.equal(s.percent, 40);
  assert.equal(s.streakMissed, 3);
  assert.equal(attendanceNote(s), 'Missed the last 3 classes.');
  assert.equal(attendanceNote(summariseAttendance([])), 'No classes held yet.');
  assert.equal(attendanceNote(summariseAttendance([{ status: 'PRESENT', startsAt: d(1) }])), 'Attendance is 100%. Regular.');
});

test('marks average only the marked papers', () => {
  const m = summariseMarks([
    { title: 'Unit 1', scorePercent: 80, passed: true, submittedAt: d(1) },
    { title: 'Unit 2', scorePercent: 50, passed: false, submittedAt: d(2) },
    { title: 'Unit 3', scorePercent: null, passed: null, submittedAt: d(3) },
  ]);
  assert.deepEqual(m, { marked: 2, average: 65, passed: 1 });
});
