import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecret, currentCode, verifyCode, otpauthUri, generateRecoveryCodes } from '../src/lib/totp';

test('a code from the secret verifies against it', () => {
  const secret = generateSecret();
  assert.equal(verifyCode(secret, currentCode(secret)), true);
});

test('a wrong code does not verify', () => {
  const secret = generateSecret();
  const wrong = currentCode(secret) === '000000' ? '111111' : '000000';
  assert.equal(verifyCode(secret, wrong), false);
});

test('a code from a different secret does not verify', () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.equal(verifyCode(a, currentCode(b)), false);
});

test('malformed input is refused rather than throwing', () => {
  const secret = generateSecret();
  assert.equal(verifyCode(secret, ''), false);
  assert.equal(verifyCode(secret, '12345'), false);
  assert.equal(verifyCode(secret, 'abcdef'), false);
});

test('the secret is base32, which is what authenticator apps accept', () => {
  assert.match(generateSecret(), /^[A-Z2-7]+$/);
});

test('the otpauth URI carries the issuer so three academies are tellable apart', () => {
  const uri = otpauthUri({ secret: 'ABCDEFGH', account: 'sree@example.com', issuer: 'Medcity' });
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes('issuer=Medcity'));
  assert.ok(uri.includes('secret=ABCDEFGH'));
});

test('recovery codes are unique within a set', () => {
  const codes = generateRecoveryCodes(8);
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
});
