import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import {
  bunnyState,
  bunnyToken,
  cloudflareState,
  cloudflareStreamToken,
  dueForCheck,
  muxState,
  muxToken,
  pemFrom,
  playbackExpiry,
  rs256Jwt,
} from '../src/lib/video/tokens';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function decode(part: string) {
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

test('an RS256 JWT verifies against the public key and carries the claims', () => {
  const jwt = rs256Jwt({ kid: 'k1' }, { sub: 'vid', exp: 1234567890 }, pem);
  const [h, b, s] = jwt.split('.');
  assert.deepEqual(decode(h), { alg: 'RS256', typ: 'JWT', kid: 'k1' });
  assert.deepEqual(decode(b), { sub: 'vid', exp: 1234567890 });
  const sig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  assert.equal(verify('sha256', Buffer.from(`${h}.${b}`), publicKey, sig), true);
});

test('the key is accepted as PEM, as base64 of PEM, or flattened by a form field', () => {
  const b64 = Buffer.from(pem).toString('base64');
  assert.equal(pemFrom(b64).trim(), pem.trim());
  assert.equal(pemFrom(pem).trim(), pem.trim());
  const flat = pem.replace(/\n/g, '');
  const rebuilt = pemFrom(flat);
  assert.ok(rebuilt.startsWith('-----BEGIN PRIVATE KEY-----\n'));
  // It must still sign.
  assert.ok(rs256Jwt({}, { a: 1 }, flat).split('.').length === 3);
});

test('provider tokens carry what each provider checks', () => {
  const exp = new Date('2026-09-13T12:00:00Z');
  const cf = decode(cloudflareStreamToken({ keyId: 'kid1', pem, videoId: 'abc', expiresAt: exp }).split('.')[1]);
  assert.equal(cf.sub, 'abc');
  assert.equal(cf.kid, 'kid1');
  assert.equal(cf.exp, Math.floor(exp.getTime() / 1000));
  const mx = decode(muxToken({ keyId: 'mk', pem, playbackId: 'pb', expiresAt: exp, audience: 'v' }).split('.')[1]);
  assert.equal(mx.sub, 'pb');
  assert.equal(mx.aud, 'v');
});

test('the bunny token is the documented hash', () => {
  const expected = createHash('sha256').update('secret' + 'guid-1' + '1700000000').digest('hex');
  assert.equal(bunnyToken({ securityKey: 'secret', videoId: 'guid-1', expires: 1700000000 }), expected);
});

test('provider states fold into four of ours', () => {
  assert.equal(cloudflareState('ready', true), 'READY');
  assert.equal(cloudflareState('inprogress', false), 'PROCESSING');
  assert.equal(cloudflareState('queued', false), 'QUEUED');
  assert.equal(cloudflareState('error', false), 'FAILED');
  assert.equal(muxState('ready'), 'READY');
  assert.equal(muxState('preparing'), 'PROCESSING');
  assert.equal(muxState('errored'), 'FAILED');
  assert.equal(bunnyState(4), 'READY');
  assert.equal(bunnyState(2), 'PROCESSING');
  assert.equal(bunnyState(5), 'FAILED');
  assert.equal(bunnyState(0), 'QUEUED');
});

test('playback links live between half an hour and a day, and checks are not hammered', () => {
  const now = new Date('2026-09-13T10:00:00Z');
  assert.equal(playbackExpiry(60, now).getTime() - now.getTime(), 60 * 60_000);
  assert.equal(playbackExpiry(1, now).getTime() - now.getTime(), 30 * 60_000);
  assert.equal(playbackExpiry(0, now).getTime() - now.getTime(), 240 * 60_000);
  assert.equal(playbackExpiry(10000, now).getTime() - now.getTime(), 24 * 60 * 60_000);
  assert.equal(dueForCheck('READY', null, now), false);
  assert.equal(dueForCheck('QUEUED', null, now), true);
  assert.equal(dueForCheck('PROCESSING', new Date(now.getTime() - 10_000), now), false);
  assert.equal(dueForCheck('PROCESSING', new Date(now.getTime() - 60_000), now), true);
});
