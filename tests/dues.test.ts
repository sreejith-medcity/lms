import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageBucket,
  allocatePayment,
  daysOverdue,
  feeNoticeFor,
  nextReceiptNumber,
  receiptPrefix,
  reminderDue,
  scheduleFromPlan,
  summariseAccount,
  worstFirst,
  type InstalmentRow,
} from '../src/lib/dues';

const now = new Date('2026-09-11T10:00:00Z');
const day = (offset: number) => new Date(now.getTime() + offset * 864e5);

function row(over: Partial<InstalmentRow> & { id: string; sequence: number }): InstalmentRow {
  return { amountPaise: 100000, paidPaise: 0, dueDate: day(0), paidAt: null, ...over };
}

test('days overdue counts whole days and is negative before the date', () => {
  assert.equal(daysOverdue(day(-3), now), 3);
  assert.equal(daysOverdue(day(0), now), 0);
  assert.equal(daysOverdue(day(2), now), -2);
  // Eleven hours late is still day zero: nobody is chased for the morning.
  assert.equal(daysOverdue(new Date(now.getTime() - 11 * 3600e3), now), 0);
});

test('ageing buckets follow the accounts convention', () => {
  assert.equal(ageBucket(day(30), now), 'CURRENT');
  assert.equal(ageBucket(day(5), now), 'DUE_SOON');
  assert.equal(ageBucket(day(0), now), 'DUE_SOON');
  assert.equal(ageBucket(day(-1), now), 'D1_7');
  assert.equal(ageBucket(day(-7), now), 'D1_7');
  assert.equal(ageBucket(day(-8), now), 'D8_30');
  assert.equal(ageBucket(day(-31), now), 'D31_60');
  assert.equal(ageBucket(day(-61), now), 'D60_PLUS');
});

test('an account is summarised from its oldest open instalment', () => {
  const summary = summariseAccount(
    [
      row({ id: 'c', sequence: 3, dueDate: day(40) }),
      row({ id: 'a', sequence: 1, dueDate: day(-45), paidPaise: 100000, paidAt: day(-45) }),
      row({ id: 'b', sequence: 2, dueDate: day(-10), paidPaise: 40000 }),
    ],
    now,
  );
  assert.equal(summary.totalPaise, 300000);
  assert.equal(summary.paidPaise, 140000);
  assert.equal(summary.balancePaise, 160000);
  assert.equal(summary.overduePaise, 60000);
  assert.equal(summary.oldestOverdueDays, 10);
  assert.equal(summary.bucket, 'D8_30');
  assert.deepEqual(summary.nextDue, { sequence: 2, balancePaise: 60000, dueDate: day(-10) });
  assert.equal(summary.settled, false);
});

test('a fully paid account is settled and sits in the current bucket', () => {
  const summary = summariseAccount(
    [row({ id: 'a', sequence: 1, dueDate: day(-90), paidPaise: 100000, paidAt: day(-90) })],
    now,
  );
  assert.equal(summary.settled, true);
  assert.equal(summary.balancePaise, 0);
  assert.equal(summary.bucket, 'CURRENT');
  assert.equal(summary.nextDue, null);
});

test('worst first: longest waiting, then owing most', () => {
  const mk = (id: string, due: number, amount: number) => ({
    id,
    summary: summariseAccount([row({ id, sequence: 1, dueDate: day(due), amountPaise: amount })], now),
  });
  const sorted = worstFirst([mk('soon', 3, 900000), mk('old', -40, 50000), mk('week', -9, 200000), mk('week-big', -9, 500000)]);
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['old', 'week-big', 'week', 'soon'],
  );
});

test('a payment settles oldest due first and can leave a part on the last one', () => {
  const rows = [
    row({ id: 'b', sequence: 2, dueDate: day(-10), amountPaise: 50000 }),
    row({ id: 'a', sequence: 1, dueDate: day(-40), amountPaise: 50000, paidPaise: 20000 }),
    row({ id: 'c', sequence: 3, dueDate: day(20), amountPaise: 50000 }),
  ];
  const result = allocatePayment(rows, 100000);
  assert.deepEqual(result.allocations, [
    { instalmentId: 'a', sequence: 1, paise: 30000, settles: true },
    { instalmentId: 'b', sequence: 2, paise: 50000, settles: true },
    { instalmentId: 'c', sequence: 3, paise: 20000, settles: false },
  ]);
  assert.equal(result.unallocatedPaise, 0);
});

test('money beyond what is owed comes back unallocated rather than kept', () => {
  const result = allocatePayment([row({ id: 'a', sequence: 1, amountPaise: 30000 })], 45000);
  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0].paise, 30000);
  assert.equal(result.unallocatedPaise, 15000);
});

test('a zero, negative or fractional sum allocates nothing', () => {
  const rows = [row({ id: 'a', sequence: 1 })];
  assert.equal(allocatePayment(rows, 0).allocations.length, 0);
  assert.equal(allocatePayment(rows, -5).allocations.length, 0);
  assert.equal(allocatePayment(rows, 10.5).allocations.length, 0);
});

test('reminders: one stage at a time, keyed so a cron cannot repeat it', () => {
  const r = row({ id: 'i1', sequence: 1, dueDate: day(0) });
  assert.equal(reminderDue(r, day(-5)), null);
  assert.deepEqual(reminderDue(r, day(-3)), { stage: 'BEFORE', tone: 'coming up', dedupeKey: 'instalment:i1:BEFORE' });
  assert.equal(reminderDue(r, day(0))?.stage, 'BEFORE');
  assert.equal(reminderDue(r, day(1))?.stage, 'ON_DAY');
  assert.equal(reminderDue(r, day(6))?.stage, 'ON_DAY');
  assert.equal(reminderDue(r, day(7))?.stage, 'WEEK');
  assert.equal(reminderDue(r, day(14))?.stage, 'FORTNIGHT');
  // Twenty days late and never reminded: the fortnight message, once.
  assert.equal(reminderDue(r, day(20))?.stage, 'FORTNIGHT');
  assert.equal(reminderDue(r, day(20))?.dedupeKey, 'instalment:i1:FORTNIGHT');
});

test('a settled instalment is never reminded about', () => {
  const r = row({ id: 'i1', sequence: 1, dueDate: day(-10), paidPaise: 100000, paidAt: day(-2) });
  assert.equal(reminderDue(r, now), null);
});

test('receipt numbers continue from the last one issued', () => {
  const prefix = receiptPrefix(2026);
  assert.equal(nextReceiptNumber(null, prefix), 'RCP-2026-00001');
  assert.equal(nextReceiptNumber('RCP-2026-00041', prefix), 'RCP-2026-00042');
  assert.equal(nextReceiptNumber('RCP-2025-00900', prefix), 'RCP-2026-00001');
  assert.equal(nextReceiptNumber('garbage', prefix), 'RCP-2026-00001');
});

test('a plan splits evenly with the remainder on the first part, first part due now', () => {
  const parts = scheduleFromPlan({ pricePaise: 100000, instalmentCount: 3 }, now);
  assert.deepEqual(
    parts.map((p) => p.amountPaise),
    [33334, 33333, 33333],
  );
  assert.equal(parts[0].dueDate.getTime(), now.getTime());
  assert.equal(parts[1].dueDate.getTime(), day(30).getTime());
  assert.equal(parts[2].dueDate.getTime(), day(60).getTime());
});

test('a spelled-out plan is used as written when it adds up', () => {
  const parts = scheduleFromPlan(
    {
      pricePaise: 100000,
      instalmentCount: 2,
      instalmentPlan: [
        { dueOffsetDays: 45, amountPaise: 40000 },
        { dueOffsetDays: 0, amountPaise: 60000 },
      ],
    },
    now,
  );
  assert.deepEqual(
    parts.map((p) => [p.sequence, p.amountPaise, daysOverdue(p.dueDate, now)]),
    [
      [1, 60000, 0],
      [2, 40000, -45],
    ],
  );
});

test('a spelled-out plan that does not add up falls back to an even split', () => {
  const parts = scheduleFromPlan(
    { pricePaise: 100000, instalmentCount: 2, instalmentPlan: [{ dueOffsetDays: 0, amountPaise: 10 }, { dueOffsetDays: 30, amountPaise: 10 }] },
    now,
  );
  assert.deepEqual(parts.map((p) => p.amountPaise), [50000, 50000]);
});

test('a one-part plan is a single instalment due now', () => {
  const parts = scheduleFromPlan({ pricePaise: 5000, instalmentCount: 1 }, now);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].amountPaise, 5000);
});

test('the home page notice says overdue first, then what is due within a week', () => {
  const overdue = feeNoticeFor([row({ id: 'a', sequence: 1, dueDate: day(-3), amountPaise: 250000, paidPaise: 50000 }), row({ id: 'b', sequence: 2, dueDate: day(2) })], now, 'INR');
  assert.equal(overdue?.overdue, true);
  assert.match(overdue!.text, /2,000/);

  const soon = feeNoticeFor([row({ id: 'a', sequence: 1, dueDate: day(2) })], now, 'INR');
  assert.equal(soon?.overdue, false);
  assert.match(soon!.text, /in 2 days/);

  assert.equal(feeNoticeFor([row({ id: 'a', sequence: 1, dueDate: day(20) })], now, 'INR'), null);
  assert.equal(feeNoticeFor([row({ id: 'a', sequence: 1, paidPaise: 100000, paidAt: now })], now, 'INR'), null);
});
