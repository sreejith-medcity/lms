import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookableSlots,
  creditsLeft,
  overlaps,
  slotStillFree,
  type WeeklyWindow,
} from '../src/lib/booking-slots';

const IST = 'Asia/Calcutta';

/** Tuesdays, 6pm to 9pm local, in half hours. */
const tuesdayEvening: WeeklyWindow = {
  weekday: 2,
  startMinute: 18 * 60,
  endMinute: 21 * 60,
  slotMinutes: 30,
};

// Tuesday 15 September 2026, 00:00 IST.
const TUESDAY = new Date('2026-09-14T18:30:00Z');
const WEEK_LATER = new Date('2026-09-21T18:30:00Z');
const MONDAY_NOON = new Date('2026-09-14T06:30:00Z');

function local(slot: { startsAt: Date }): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(slot.startsAt);
}

test('a weekly window becomes slots on that weekday, in the academy’s own time', () => {
  const slots = bookableSlots({
    availability: [tuesdayEvening],
    blackouts: [],
    busy: [],
    durationMinutes: 30,
    timeZone: IST,
    from: TUESDAY,
    to: WEEK_LATER,
    now: MONDAY_NOON,
  });

  assert.equal(slots.length, 6, 'six half hours between six and nine');
  assert.equal(local(slots[0]), 'Tue 18:00');
  assert.equal(local(slots[5]), 'Tue 20:30');
});

test('a longer booking takes fewer slots and never runs past the window', () => {
  const slots = bookableSlots({
    availability: [tuesdayEvening],
    blackouts: [],
    busy: [],
    durationMinutes: 60,
    timeZone: IST,
    from: TUESDAY,
    to: WEEK_LATER,
    now: MONDAY_NOON,
  });

  assert.equal(local(slots[slots.length - 1]), 'Tue 20:00');
  for (const slot of slots) {
    assert.ok(slot.endsAt.getTime() - slot.startsAt.getTime() === 3_600_000);
  }
});

test('a class already in the diary removes the slots it covers', () => {
  const busy = [
    {
      startsAt: new Date('2026-09-15T13:00:00Z'), // 18:30 IST
      endsAt: new Date('2026-09-15T14:00:00Z'), // 19:30 IST
    },
  ];

  const slots = bookableSlots({
    availability: [tuesdayEvening],
    blackouts: [],
    busy,
    durationMinutes: 30,
    timeZone: IST,
    from: TUESDAY,
    to: WEEK_LATER,
    now: MONDAY_NOON,
  });

  const times = slots.map(local);
  assert.deepEqual(times, ['Tue 18:00', 'Tue 19:30', 'Tue 20:00', 'Tue 20:30']);
});

test('a day the trainer is away offers nothing', () => {
  const slots = bookableSlots({
    availability: [tuesdayEvening],
    blackouts: [
      { startsAt: new Date('2026-09-15T00:00:00Z'), endsAt: new Date('2026-09-16T00:00:00Z') },
    ],
    busy: [],
    durationMinutes: 30,
    timeZone: IST,
    from: TUESDAY,
    to: WEEK_LATER,
    now: MONDAY_NOON,
  });

  assert.deepEqual(slots, []);
});

test('notice removes what is too soon rather than offering it', () => {
  // Standing at 17:00 IST on the Tuesday, with twelve hours of notice.
  const now = new Date('2026-09-15T11:30:00Z');

  const slots = bookableSlots({
    availability: [tuesdayEvening],
    blackouts: [],
    busy: [],
    durationMinutes: 30,
    timeZone: IST,
    from: now,
    to: WEEK_LATER,
    minNoticeHours: 12,
    now,
  });

  assert.equal(slots.length, 0, 'this evening is too soon and there is no other Tuesday in range');
});

test('a window that has not started or has ended is not offered', () => {
  const expired: WeeklyWindow = { ...tuesdayEvening, validUntil: new Date('2026-01-01T00:00:00Z') };
  const future: WeeklyWindow = { ...tuesdayEvening, validFrom: new Date('2027-01-01T00:00:00Z') };
  const off: WeeklyWindow = { ...tuesdayEvening, isActive: false };

  for (const window of [expired, future, off]) {
    const slots = bookableSlots({
      availability: [window],
      blackouts: [],
      busy: [],
      durationMinutes: 30,
      timeZone: IST,
      from: TUESDAY,
      to: WEEK_LATER,
      now: MONDAY_NOON,
    });
    assert.deepEqual(slots, []);
  }
});

test('slots come back in order and never past the end of the window asked for', () => {
  const slots = bookableSlots({
    availability: [tuesdayEvening, { ...tuesdayEvening, weekday: 4 }],
    blackouts: [],
    busy: [],
    durationMinutes: 30,
    timeZone: IST,
    from: TUESDAY,
    to: new Date('2026-09-30T00:00:00Z'),
    now: MONDAY_NOON,
  });

  for (let i = 1; i < slots.length; i += 1) {
    assert.ok(slots[i].startsAt >= slots[i - 1].startsAt, 'sorted');
  }
  assert.ok(slots.every((s) => s.endsAt <= new Date('2026-09-30T00:00:00Z')));
});

test('a wide window cannot produce thousands of slots', () => {
  const slots = bookableSlots({
    availability: [{ weekday: 1, startMinute: 0, endMinute: 24 * 60, slotMinutes: 15 }],
    blackouts: [],
    busy: [],
    durationMinutes: 15,
    timeZone: IST,
    from: TUESDAY,
    to: new Date('2027-09-14T00:00:00Z'),
    now: MONDAY_NOON,
    limit: 50,
  });

  assert.equal(slots.length, 50);
});

test('overlap is the standard test, and touching is not overlapping', () => {
  const a = { startsAt: new Date('2026-09-15T10:00:00Z'), endsAt: new Date('2026-09-15T11:00:00Z') };
  const touching = { startsAt: new Date('2026-09-15T11:00:00Z'), endsAt: new Date('2026-09-15T12:00:00Z') };
  const inside = { startsAt: new Date('2026-09-15T10:15:00Z'), endsAt: new Date('2026-09-15T10:30:00Z') };

  assert.equal(overlaps(a, touching), false, 'back to back classes are fine');
  assert.equal(overlaps(a, inside), true);
  assert.equal(overlaps(inside, a), true, 'the answer does not depend on the order');
});

test('the slot is checked again at booking, since two people can be looking at it', () => {
  const slot = {
    startsAt: new Date('2026-09-15T13:00:00Z'),
    endsAt: new Date('2026-09-15T13:30:00Z'),
  };
  const common = {
    slot,
    availability: [tuesdayEvening],
    blackouts: [],
    timeZone: IST,
    now: MONDAY_NOON,
  };

  assert.deepEqual(slotStillFree({ ...common, busy: [] }), { ok: true });
  assert.equal(slotStillFree({ ...common, busy: [slot] }).reason, 'TAKEN');
  assert.equal(
    slotStillFree({ ...common, busy: [], blackouts: [slot] }).reason,
    'AWAY',
  );
  assert.equal(
    slotStillFree({ ...common, busy: [], minNoticeHours: 48 }).reason,
    'TOO_SOON',
  );
  assert.equal(
    slotStillFree({
      ...common,
      busy: [],
      slot: {
        startsAt: new Date('2026-09-15T04:00:00Z'),
        endsAt: new Date('2026-09-15T04:30:00Z'),
      },
    }).reason,
    'OUTSIDE_HOURS',
  );
});

test('credits are what was bought minus what is booked, and never negative', () => {
  assert.deepEqual(creditsLeft({ sessionsTotal: 4, bookedCount: 1 }), { left: 3, expired: false });
  assert.deepEqual(creditsLeft({ sessionsTotal: 4, bookedCount: 9 }), { left: 0, expired: false });

  const expired = creditsLeft({
    sessionsTotal: 4,
    bookedCount: 0,
    expiresAt: new Date('2026-01-01T00:00:00Z'),
    now: MONDAY_NOON,
  });
  assert.equal(expired.expired, true);
});
