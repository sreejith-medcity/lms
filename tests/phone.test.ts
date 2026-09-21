import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signupPhone } from '../src/lib/phone';

test('an Indian mobile comes out as ten digits however it was typed', () => {
  assert.equal(signupPhone('98470 12345'), '9847012345');
  assert.equal(signupPhone('098470-12345'), '9847012345');
  assert.equal(signupPhone('+91 98470 12345'), '9847012345');
  assert.equal(signupPhone('919847012345'), '9847012345');
  assert.equal(signupPhone('0091 9847012345'), '9847012345');
});

test('a number from abroad keeps its country code with a plus', () => {
  assert.equal(signupPhone('+971 50 123 4567'), '+971501234567');
  assert.equal(signupPhone('00447700900123'), '+447700900123');
});

test('what is not a mobile is refused rather than kept', () => {
  assert.equal(signupPhone('12345'), null);
  assert.equal(signupPhone('0484 2345678'), null);
  assert.equal(signupPhone('5847012345'), null);
  assert.equal(signupPhone('+1'), null);
  assert.equal(signupPhone('call me'), null);
});
