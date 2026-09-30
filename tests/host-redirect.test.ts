import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostRedirect, parseHostRedirects } from '../src/lib/host-redirect';

const env = 'demo.medcitylms.in=https://medcitylms.com/, bad=ftp://x, =https://y.com';

test('a moved address keeps its path and query on the new one', () => {
  assert.equal(hostRedirect('demo.medcitylms.in', '/course/german-a1', '?utm_source=wa', env), 'https://medcitylms.com/course/german-a1?utm_source=wa');
  assert.equal(hostRedirect('DEMO.medcitylms.in', '/', '', env), 'https://medcitylms.com/');
  assert.equal(hostRedirect('medcitylms.com', '/', '', env), null);
  assert.equal(parseHostRedirects(env).size, 1);
});

test('the API, the build files and an unset variable are left alone', () => {
  assert.equal(hostRedirect('demo.medcitylms.in', '/api/payments/razorpay/webhook', '', env), null);
  assert.equal(hostRedirect('demo.medcitylms.in', '/_next/static/x.js', '', env), null);
  assert.equal(hostRedirect('demo.medcitylms.in', '/', '', undefined), null);
  assert.equal(hostRedirect('a.com', '/', '', 'a.com=https://a.com'), null);
});
