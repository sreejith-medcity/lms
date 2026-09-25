import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyRedirect, legacyTestPath } from '../src/lib/exams/legacy';

test('the telc site addresses land on their portal pages', () => {
  assert.equal(legacyTestPath('/b1-telc-mocktest'), '/tests/b1-telc-mocktest');
  assert.equal(legacyTestPath('/A2'), '/tests/a2-telc-mocktest');
  assert.equal(legacyTestPath('/b2/'), '/tests/b2-telc-mocktest');
  assert.equal(legacyTestPath('/dashboard/start'), '/learn/tests');
  assert.equal(legacyTestPath('/sign-in'), '/login');
  assert.equal(legacyTestPath('/buy'), '/tests');
  assert.equal(legacyTestPath('/'), '/tests');
  assert.equal(legacyTestPath('/c1-telc-mocktest'), '/tests');
});

test('only a listed host with a proper target is redirected', () => {
  const env = { hosts: 'telc.medcitylms.in, ielts.medcitylms.in', target: 'https://medcitylms.in/' };
  assert.equal(legacyRedirect('telc.medcitylms.in', '/a1-telc-mocktest', env), 'https://medcitylms.in/tests/a1-telc-mocktest');
  assert.equal(legacyRedirect('demo.medcitylms.in', '/a1', env), null);
  assert.equal(legacyRedirect('telc.medcitylms.in', '/a1', { hosts: env.hosts }), null);
  assert.equal(legacyRedirect('telc.medcitylms.in', '/a1', { hosts: env.hosts, target: 'javascript:alert(1)' }), null);
});
