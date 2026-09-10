import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseContact, normaliseIndianMobile } from '../src/lib/guest-checkout';

test('a mobile number is accepted however it was typed', () => {
  for (const raw of ['9847012345', '+91 98470 12345', '098470-12345', '0091 9847012345']) {
    assert.equal(normaliseIndianMobile(raw), '9847012345', raw);
  }
});

test('a number that cannot be an Indian mobile is refused', () => {
  for (const raw of ['12345', '5847012345', '', 'call me', '04842345678901234']) {
    assert.equal(normaliseIndianMobile(raw), null, raw);
  }
});

test('a complete contact comes back tidied', () => {
  const out = normaliseContact({
    name: '  Anu   Mathew ',
    email: '  ANU@Example.COM ',
    phone: '+91 98470 12345',
  });

  assert.deepEqual(out, { ok: true, name: 'Anu Mathew', email: 'anu@example.com', phone: '9847012345' });
});

test('each missing field says what to do about it', () => {
  const cases: [Record<string, string>, RegExp][] = [
    [{ email: 'a@b.com', phone: '9847012345' }, /name/i],
    [{ name: 'Anu', phone: '9847012345' }, /email/i],
    [{ name: 'Anu', email: 'a@b.com' }, /mobile/i],
    [{ name: 'Anu', email: 'not-an-email', phone: '9847012345' }, /email/i],
  ];

  for (const [input, expected] of cases) {
    const out = normaliseContact(input);
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, expected, JSON.stringify(input));
  }
});

test('nothing at all is refused rather than throwing', () => {
  assert.equal(normaliseContact(undefined).ok, false);
});
