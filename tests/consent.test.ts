import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMarketing, optedOut, parseClock, releaseAfterQuietHours } from '../src/lib/consent';

const TZ = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso);

test('service and marketing are told apart by the event key', () => {
  assert.equal(isMarketing('campaign:abc'), true);
  assert.equal(isMarketing('workflow:Welcome'), true);
  assert.equal(isMarketing('cart.abandoned'), true);
  assert.equal(isMarketing('payment.received'), false);
  assert.equal(isMarketing('session.reminder'), false);
  assert.equal(isMarketing('account.otp'), false);
});

test('opt-outs are per channel and never touch push', () => {
  const p = { emailOptOut: true, smsOptOut: false, whatsappOptOut: true };
  assert.equal(optedOut(p, 'EMAIL'), true);
  assert.equal(optedOut(p, 'SMS'), false);
  assert.equal(optedOut(p, 'WHATSAPP'), true);
  assert.equal(optedOut(p, 'PUSH'), false);
});

test('clock strings', () => {
  assert.equal(parseClock('21:00'), 1260);
  assert.equal(parseClock('8:05'), 485);
  assert.equal(parseClock(''), null);
  assert.equal(parseClock('25:00'), null);
  assert.equal(parseClock('nine'), null);
});

test('quiet hours across midnight, in the academy timezone', () => {
  // 23:30 IST on 11 Sep is 18:00 UTC.
  const late = at('2026-09-11T18:00:00Z');
  const released = releaseAfterQuietHours(late, TZ, '21:00', '08:00');
  assert.equal(released.toISOString(), '2026-09-12T02:30:00.000Z', 'held until 08:00 IST next morning');

  // 03:00 IST on 12 Sep is 21:30 UTC on 11 Sep: same window, same release.
  const small = at('2026-09-11T21:30:00Z');
  assert.equal(releaseAfterQuietHours(small, TZ, '21:00', '08:00').toISOString(), '2026-09-12T02:30:00.000Z');

  // 14:00 IST is outside the window.
  const day = at('2026-09-11T08:30:00Z');
  assert.equal(releaseAfterQuietHours(day, TZ, '21:00', '08:00').getTime(), day.getTime());

  // Exactly 08:00 IST is already released.
  const eight = at('2026-09-12T02:30:00Z');
  assert.equal(releaseAfterQuietHours(eight, TZ, '21:00', '08:00').getTime(), eight.getTime());
});

test('a same-day window, a blank window, and nonsense', () => {
  const lunch = at('2026-09-11T08:00:00Z'); // 13:30 IST
  assert.equal(releaseAfterQuietHours(lunch, TZ, '13:00', '15:00').toISOString(), '2026-09-11T09:30:00.000Z');
  assert.equal(releaseAfterQuietHours(lunch, TZ, '', '').getTime(), lunch.getTime());
  assert.equal(releaseAfterQuietHours(lunch, TZ, '21:00', '21:00').getTime(), lunch.getTime());
  assert.equal(releaseAfterQuietHours(lunch, TZ, 'x', '08:00').getTime(), lunch.getTime());
});
