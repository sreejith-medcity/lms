import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signupProblem, slugProblem, slugify, suggestSlug, trialEnd } from '../src/lib/platform/signup';

const good = { academyName: 'Bright Path Academy', slug: 'bright-path', ownerName: 'Anu', email: 'anu@example.com', phone: '98470 12345', password: 'longenough', planCode: 'starter' };

test('slugs are made from names and refuse the reserved ones', () => {
  assert.equal(slugify('Bright Path Academy!'), 'bright-path-academy');
  assert.equal(suggestSlug('Admin'), 'academy');
  assert.equal(slugProblem('bright-path'), null);
  assert.equal(slugProblem('ab'), 'The address needs at least three characters.');
  assert.equal(slugProblem('-bad-'), 'Letters, digits and hyphens only, starting and ending with a letter or digit.');
  assert.equal(slugProblem('platform'), 'That address is reserved. Try another.');
});

test('a signup is checked field by field, and the honeypot ends it quietly', () => {
  assert.equal(signupProblem(good), null);
  assert.equal(signupProblem({ ...good, email: 'nope' }), 'That does not look like an email address.');
  assert.equal(signupProblem({ ...good, phone: '123' }), 'A mobile number with at least ten digits, please.');
  assert.equal(signupProblem({ ...good, password: 'short' }), 'A password of at least eight characters.');
  assert.equal(signupProblem({ ...good, website: 'http://spam' }), 'Something went wrong. Please try again.');
});

test('a trial ends the given number of days later', () => {
  assert.equal(trialEnd(new Date('2026-09-13T00:00:00Z'), 14).toISOString(), '2026-09-27T00:00:00.000Z');
});
