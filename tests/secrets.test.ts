import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, open, mask } from '../src/lib/secrets';

/**
 * Every gateway key, every WhatsApp token and every two-factor secret in the
 * product goes through these three functions.
 */

test('what was sealed comes back', () => {
  const secret = 'rzp_live_ABC123xyz';
  assert.equal(open(seal(secret)), secret);
});

test('sealing twice gives different ciphertext, so a repeated key is not obvious', () => {
  assert.notEqual(seal('same'), seal('same'));
});

test('the plaintext never appears in the sealed value', () => {
  assert.ok(!seal('rzp_live_ABC123xyz').includes('ABC123xyz'));
});

test('a tampered value is refused rather than half decrypted', () => {
  const sealed = seal('rzp_live_ABC123xyz');
  const parts = sealed.split('.');
  parts[parts.length - 1] = `${parts[parts.length - 1].slice(0, -2)}ZZ`;
  assert.equal(open(parts.join('.')), null);
});

test('rubbish in gives null, not an exception', () => {
  assert.equal(open('not-a-sealed-value'), null);
  assert.equal(open(''), null);
});

test('unicode and long values survive the round trip', () => {
  const value = 'കീ-value-with-emoji-and-a-very-long-tail-'.repeat(20);
  assert.equal(open(seal(value)), value);
});

test('a mask shows the last four and hides the rest', () => {
  const masked = mask('rzp_live_ABC123xyz');
  assert.ok(masked.endsWith('3xyz'));
  assert.ok(!masked.includes('ABC12'));
});
