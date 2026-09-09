import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatedCostPaise, formatPaise } from '../src/lib/messaging/pricing';

/**
 * The wallet is only as honest as this. An SMS costed at one segment when the
 * carrier bills three drains a balance three times faster than the screen says,
 * and the first anyone knows is a batch of reminders that silently stopped.
 */

test('a short English SMS is one segment', () => {
  assert.equal(estimatedCostPaise('SMS', 'Your class starts at 7pm.'), 20);
});

test('160 characters is still one segment, 161 is two', () => {
  assert.equal(estimatedCostPaise('SMS', 'a'.repeat(160)), 20);
  assert.equal(estimatedCostPaise('SMS', 'a'.repeat(161)), 40);
});

test('one non-ascii character cuts the segment to 70, which is the expensive surprise', () => {
  // 100 plain characters is one segment; the same text with a single Malayalam
  // character in it is two, because the whole message becomes unicode.
  assert.equal(estimatedCostPaise('SMS', 'a'.repeat(100)), 20);
  assert.equal(estimatedCostPaise('SMS', `${'a'.repeat(99)}ം`), 40);
});

test('an empty body still costs one segment, because the carrier still bills one', () => {
  assert.equal(estimatedCostPaise('SMS', ''), 20);
});

test('whatsapp is per message, not per segment', () => {
  assert.equal(estimatedCostPaise('WHATSAPP', 'a'.repeat(500)), 85);
});

test('email is free by default, and in-product channels cost nothing', () => {
  assert.equal(estimatedCostPaise('EMAIL', 'anything'), 0);
  assert.equal(estimatedCostPaise('IN_APP', 'anything'), 0);
});

test('money is shown in rupees, two places, never in paise', () => {
  assert.equal(formatPaise(0), 'INR 0.00');
  assert.equal(formatPaise(20), 'INR 0.20');
  assert.equal(formatPaise(500000), 'INR 5000.00');
});
