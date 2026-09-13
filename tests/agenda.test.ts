import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignmentDueItem, calendarToken, calendarTokenMatches, classItem, groupByDay, toIcs } from '../src/lib/agenda';

const TZ = 'Asia/Kolkata';

test('a class lands on the academy day it belongs to, whatever the server clock', () => {
  // 11:30pm IST on 12 Sep is 18:00 UTC the same day; 1:30am IST on 13 Sep is 20:00 UTC on the 12th.
  const late = classItem({ id: 's1', title: 'Grammar', startsAt: new Date('2026-09-12T20:00:00Z'), endsAt: new Date('2026-09-12T21:00:00Z'), status: 'SCHEDULED', isHoliday: false, joinUrl: 'https://zoom.us/j/1', batchName: 'A1 evening', learnerId: null }, TZ, new Date('2026-09-12T10:00:00Z'));
  assert.equal(late.day, '2026-09-13');
  assert.equal(late.kind, 'CLASS');
  assert.equal(late.status, 'SCHEDULED');
  const live = classItem({ id: 's2', title: 'Now', startsAt: new Date('2026-09-12T09:30:00Z'), endsAt: new Date('2026-09-12T10:30:00Z'), status: 'SCHEDULED', isHoliday: false, joinUrl: null, batchName: null, learnerId: 'u1' }, TZ, new Date('2026-09-12T10:00:00Z'));
  assert.equal(live.status, 'LIVE');
  assert.equal(live.kind, 'ONE_TO_ONE');
});

test('items group into the week in time order', () => {
  const a = assignmentDueItem({ id: 'a1', title: 'Letter', dueAt: new Date('2026-09-14T11:30:00Z'), course: 'A1' }, TZ);
  const b = classItem({ id: 's1', title: 'Class', startsAt: new Date('2026-09-14T03:30:00Z'), endsAt: new Date('2026-09-14T04:30:00Z'), status: 'SCHEDULED', isHoliday: false, joinUrl: null, batchName: 'A1', learnerId: null }, TZ);
  const map = groupByDay([a, b], ['2026-09-14', '2026-09-15']);
  assert.deepEqual(map.get('2026-09-14')!.map((i) => i.id), ['session:s1', 'assignment:a1']);
  assert.deepEqual(map.get('2026-09-15'), []);
});

test('the feed token is stable, secret-bound and checked in constant time', () => {
  const t = calendarToken('user1', 'secret');
  assert.equal(t, calendarToken('user1', 'secret'));
  assert.notEqual(t, calendarToken('user1', 'other'));
  assert.equal(calendarTokenMatches('user1', t, 'secret'), true);
  assert.equal(calendarTokenMatches('user1', 'x', 'secret'), false);
});

test('the iCal feed is well formed and folds long lines', () => {
  const ics = toIcs({
    name: 'Medcity International Academy',
    origin: 'https://demo.medcitylms.in',
    timeZone: TZ,
    items: [
      classItem({ id: 's1', title: 'German A1: Perfekt, Modalverben and a very long lesson title that keeps going past the fold', startsAt: new Date('2026-09-14T13:30:00Z'), endsAt: new Date('2026-09-14T14:30:00Z'), status: 'SCHEDULED', isHoliday: false, joinUrl: 'https://zoom.us/j/123', batchName: 'A1 evening; Kochi', learnerId: null }, TZ),
      assignmentDueItem({ id: 'a1', title: 'Letter', dueAt: new Date('2026-09-16T11:30:00Z'), course: 'A1' }, TZ),
    ],
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20260914T133000Z/);
  assert.match(ics, /DESCRIPTION:A1 evening\\; Kochi\\nJoin: https:\/\/zoom.us\/j\/123/);
  assert.match(ics, /URL:https:\/\/zoom.us\/j\/123/);
  assert.match(ics, /\r\n /, 'a folded continuation line');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});
