import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromStatus, failed, sent } from '../src/lib/messaging/types';
import { msisdn } from '../src/lib/messaging/sms';

/**
 * The drain trusts each adapter's judgement about whether a failure is worth
 * retrying. Getting that backwards either burns money retrying a number that
 * will never work, or gives up on a provider that was down for ten seconds.
 */

test('a 4xx is permanent, because the same wrong request will be wrong again', () => {
  assert.equal(fromStatus(400, 'bad template').permanent, true);
  assert.equal(fromStatus(401, 'bad key').permanent, true);
  assert.equal(fromStatus(422, 'not on whatsapp').permanent, true);
});

test('a 5xx is worth retrying', () => {
  assert.equal(fromStatus(500, 'oops').permanent, false);
  assert.equal(fromStatus(503, 'maintenance').permanent, false);
});

test('rate limiting and timeout are retried, not given up on', () => {
  assert.equal(fromStatus(429, 'slow down').permanent, false);
  assert.equal(fromStatus(408, 'timeout').permanent, false);
});

test('a provider error never reports a cost', () => {
  assert.equal(fromStatus(500, 'oops').costPaise, 0);
  assert.equal(failed('nope').costPaise, 0);
  assert.equal(failed('nope').ok, false);
});

test('a long provider message is trimmed before it reaches a log row', () => {
  const result = failed('x'.repeat(1000));
  assert.ok((result.error ?? '').length <= 300);
});

test('a success carries the provider reference through', () => {
  assert.deepEqual(sent('abc123', 20), { ok: true, providerRef: 'abc123', costPaise: 20 });
});

test('an Indian number is normalised however it was typed', () => {
  for (const input of ['9847012345', '09847012345', '+91 98470 12345', '91-9847012345']) {
    assert.equal(msisdn(input, true), '919847012345', `failed on ${input}`);
    assert.equal(msisdn(input, false), '9847012345', `failed on ${input}`);
  }
});
