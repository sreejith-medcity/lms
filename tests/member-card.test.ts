import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberCode, readMemberCode } from '../src/lib/member-card';

test('a card made here reads back as its learner', () => {
  const code = memberCode('cm1abcdefghijklmnop');
  assert.match(code, /^MC1\./);
  assert.deepEqual(readMemberCode(code), { kind: 'user', userId: 'cm1abcdefghijklmnop' });
  assert.deepEqual(readMemberCode(`  ${code}\n`), { kind: 'user', userId: 'cm1abcdefghijklmnop' });
});

test('a card with the signature changed, or another learner pasted in, reads as nothing', () => {
  const code = memberCode('cm1abcdefghijklmnop');
  const [prefix, userId, sig] = code.split('.');
  assert.equal(readMemberCode(`${prefix}.${userId}.${sig.slice(0, -1)}x`), null);
  assert.equal(readMemberCode(`${prefix}.cm1zzzzzzzzzzzzzzzz.${sig}`), null);
  assert.equal(readMemberCode('MC1.cm1abcdefghijklmnop'), null);
  assert.equal(readMemberCode('https://example.com/whatever'), null);
  assert.equal(readMemberCode(''), null);
});

test('a plain number is a registration number for the desk with no scanner', () => {
  assert.deepEqual(readMemberCode('459'), { kind: 'registration', registrationNo: 459 });
  assert.deepEqual(readMemberCode(' 3105 '), { kind: 'registration', registrationNo: 3105 });
  assert.equal(readMemberCode('1234567890123'), null);
});
