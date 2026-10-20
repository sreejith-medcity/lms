import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventEnd, eventIcs, eventPhase, eventWhen, joinLinkOpen, registrationProblem, seatsLeft } from '../src/lib/event-rules';

const at = (iso: string) => new Date(iso);
const base = { published: true, startsAt: at('2026-11-01T10:00:00Z'), endsAt: at('2026-11-01T12:00:00Z'), capacity: 10, taken: 3 };

test('an event with no end runs two hours', () => {
  assert.equal(eventEnd({ startsAt: at('2026-11-01T10:00:00Z'), endsAt: null })?.toISOString(), '2026-11-01T12:00:00.000Z');
  assert.equal(eventEnd({ startsAt: null, endsAt: null }), null);
});

test('upcoming, live, over', () => {
  assert.equal(eventPhase(base, at('2026-11-01T09:59:00Z')), 'UPCOMING');
  assert.equal(eventPhase(base, at('2026-11-01T10:00:00Z')), 'LIVE');
  assert.equal(eventPhase(base, at('2026-11-01T12:00:00Z')), 'OVER');
});

test('registration stays open while it runs, closes when full, over, unpublished or undated', () => {
  assert.equal(registrationProblem(base, at('2026-10-30T00:00:00Z')), null);
  assert.equal(registrationProblem(base, at('2026-11-01T11:00:00Z')), null);
  assert.match(registrationProblem({ ...base, taken: 10 }, at('2026-10-30T00:00:00Z')) ?? '', /full/);
  assert.match(registrationProblem(base, at('2026-11-01T13:00:00Z')) ?? '', /over/);
  assert.match(registrationProblem({ ...base, published: false }, at('2026-10-30T00:00:00Z')) ?? '', /not open/);
  assert.match(registrationProblem({ ...base, startsAt: null }, at('2026-10-30T00:00:00Z')) ?? '', /no date/);
  assert.equal(registrationProblem({ ...base, capacity: null, taken: 999 }, at('2026-10-30T00:00:00Z')), null);
});

test('places left, with no cap meaning no count', () => {
  assert.equal(seatsLeft(base), 7);
  assert.equal(seatsLeft({ capacity: 0, taken: 4 }), null);
  assert.equal(seatsLeft({ capacity: 5, taken: 9 }), 0);
});

test('the join link shows from half an hour before until the end', () => {
  assert.equal(joinLinkOpen(base, at('2026-11-01T09:29:00Z')), false);
  assert.equal(joinLinkOpen(base, at('2026-11-01T09:30:00Z')), true);
  assert.equal(joinLinkOpen(base, at('2026-11-01T11:59:00Z')), true);
  assert.equal(joinLinkOpen(base, at('2026-11-01T12:00:00Z')), false);
});

test('when reads in the academy zone', () => {
  const label = eventWhen(at('2026-11-01T04:30:00Z'), at('2026-11-01T06:30:00Z'), 'Asia/Kolkata');
  assert.match(label, /1 Nov/);
  assert.match(label, /10:00/);
  assert.match(label, /12:00/);
  assert.ok(!label.includes('Nov,') || label.split('Nov').length === 2, 'one day named once');
  assert.equal(eventWhen(null, null, 'Asia/Kolkata'), 'Date to be announced');
  const overnight = eventWhen(at('2026-11-01T15:30:00Z'), at('2026-11-01T19:30:00Z'), 'Asia/Kolkata');
  assert.equal(overnight.split('Nov').length, 3, 'both days named when it runs past midnight');
});

test('the calendar file is valid enough for a phone', () => {
  const ics = eventIcs({
    uid: 'event-1@demo',
    title: 'OET open day, Kannur; hall 2',
    startsAt: at('2026-11-01T04:30:00Z'),
    endsAt: null,
    location: 'Kannur campus, hall 2',
    url: 'https://demo.example/event/oet-open-day',
    organizer: 'Medcity',
    now: at('2026-10-20T00:00:00Z'),
  });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART:20261101T043000Z'));
  assert.ok(ics.includes('DTEND:20261101T063000Z'));
  assert.ok(ics.includes('SUMMARY:OET open day\\, Kannur\\; hall 2'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
});
