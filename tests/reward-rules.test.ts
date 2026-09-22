import test from 'node:test';
import assert from 'node:assert/strict';
import { fullMonth, looksLikeVoucher, normaliseVoucherCode, ruleMet, stampOutcome, voucherCodeFrom, voucherDiscount, voucherRefusal, VOUCHER_ALPHABET } from '../src/lib/reward-rules';

test('a percentage voucher is capped and never exceeds the order', () => {
  assert.equal(voucherDiscount({ kind: 'PERCENT', value: 10, maxDiscountPaise: null }, 100_000), 10_000);
  assert.equal(voucherDiscount({ kind: 'PERCENT', value: 10, maxDiscountPaise: 5_000 }, 100_000), 5_000);
  assert.equal(voucherDiscount({ kind: 'PERCENT', value: 150, maxDiscountPaise: null }, 100_000), 100_000);
});

test('a flat voucher is worth its amount, up to the order', () => {
  assert.equal(voucherDiscount({ kind: 'FLAT', value: 50_000, maxDiscountPaise: null }, 100_000), 50_000);
  assert.equal(voucherDiscount({ kind: 'FLAT', value: 500_000, maxDiscountPaise: null }, 100_000), 100_000);
  assert.equal(voucherDiscount({ kind: 'FLAT', value: -5, maxDiscountPaise: null }, 100_000), 0);
});

test('codes avoid the confusable characters and read back through the normaliser', () => {
  const code = voucherCodeFrom((n) => (n - 1) % n);
  assert.match(code, /^V-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  for (const bad of '0O1IL8B5S') assert.equal(VOUCHER_ALPHABET.includes(bad), false, bad);
  assert.equal(normaliseVoucherCode(' v-abcd-efgh '), 'V-ABCD-EFGH');
  assert.equal(normaliseVoucherCode('vabcdefgh'), 'V-ABCD-EFGH');
  assert.equal(normaliseVoucherCode('MC-ABCD-EFGH'), 'MC-ABCD-EFGH');
  assert.equal(normaliseVoucherCode(''), '');
});

test('a voucher is told from a promo code by its shape', () => {
  assert.equal(looksLikeVoucher('v-acdd-efgh'), true);
  assert.equal(looksLikeVoucher('VACDDEFGH'), true);
  assert.equal(looksLikeVoucher('FIRST50'), false);
  assert.equal(looksLikeVoucher('WELCOME-10'), false, 'letters outside the voucher alphabet');
  assert.equal(looksLikeVoucher('MEDCITY2026'), false);
});

test('a voucher refuses in the right order and is free to be claimed when nobody holds it', () => {
  const now = new Date('2026-09-22T10:00:00Z');
  const base = { status: 'ISSUED', expiresAt: null, userId: null, productId: null };
  assert.equal(voucherRefusal(base, { userId: 'u1', productId: 'p1', now }), null);
  assert.equal(voucherRefusal({ ...base, status: 'REDEEMED' }, { userId: 'u1', productId: 'p1', now }), 'REDEEMED');
  assert.equal(voucherRefusal({ ...base, status: 'CANCELLED' }, { userId: 'u1', productId: 'p1', now }), 'CANCELLED');
  assert.equal(voucherRefusal({ ...base, expiresAt: new Date('2026-09-21T00:00:00Z') }, { userId: 'u1', productId: 'p1', now }), 'EXPIRED');
  assert.equal(voucherRefusal({ ...base, userId: 'u2' }, { userId: 'u1', productId: 'p1', now }), 'NOT_YOURS');
  assert.equal(voucherRefusal({ ...base, userId: 'u1', productId: 'p2' }, { userId: 'u1', productId: 'p1', now }), 'WRONG_PRODUCT');
  assert.equal(voucherRefusal({ ...base, productId: 'p2' }, { userId: 'u1', productId: null, now }), null, 'no course yet means no course check');
});

test('a card fills on the last stamp and starts again at zero', () => {
  assert.deepEqual(stampOutcome(0, 8), { stamps: 1, full: false });
  assert.deepEqual(stampOutcome(6, 8), { stamps: 7, full: false });
  assert.deepEqual(stampOutcome(7, 8), { stamps: 0, full: true });
  assert.deepEqual(stampOutcome(0, 1), { stamps: 0, full: true });
  assert.deepEqual(stampOutcome(0, 0), { stamps: 0, full: true }, 'a card needing nothing still needs one');
});

test('a full month needs every class over, enough of them, and all attended', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const past = (attended: boolean) => ({ endsAt: new Date('2026-09-15T10:00:00Z'), attended });
  assert.equal(fullMonth([past(true), past(true), past(true)], 3, now), true);
  assert.equal(fullMonth([past(true), past(true)], 3, now), false, 'too few classes');
  assert.equal(fullMonth([past(true), past(false), past(true)], 3, now), false, 'one missed');
  assert.equal(fullMonth([past(true), past(true), { endsAt: new Date('2026-10-05T10:00:00Z'), attended: false }], 3, now), false, 'month not over');
  assert.equal(fullMonth([], 1, now), false);
});

test('rules with a number need it met; the others are met by happening', () => {
  assert.equal(ruleMet('PASSED_FIRST_ATTEMPT', 60, 59), false);
  assert.equal(ruleMet('PASSED_FIRST_ATTEMPT', 60, 60), true);
  assert.equal(ruleMet('STREAK_DAYS', 30, 31), true);
  assert.equal(ruleMet('FULL_MONTH_ATTENDANCE', 8, 3), false);
  assert.equal(ruleMet('MODULE_FINISHED', 99, 0), true);
  assert.equal(ruleMet('COURSE_COMPLETED', 0, 0), true);
});
