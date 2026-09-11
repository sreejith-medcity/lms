import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseResultPayload,
  signHandoff,
  signResultBody,
  verifyHandoff,
  verifyResultSignature,
} from '../src/lib/partner-sso';

const secret = 'shared-secret';
const now = new Date('2026-09-11T10:00:00Z');
const claims = { sub: 'u1', name: 'Anjali', email: 'a@x.in', phone: null, org: 'org1', jti: 'r1', grants: ['B1'] };

test('a handoff round-trips within its window', () => {
  const token = signHandoff(claims, secret, now);
  const v = verifyHandoff(token, secret, new Date(now.getTime() + 60_000));
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.claims.sub, 'u1');
    assert.deepEqual(v.claims.grants, ['B1']);
    assert.equal(v.claims.exp - v.claims.iat, 300);
  }
});

test('a handoff is refused when expired, tampered or signed with another secret', () => {
  const token = signHandoff(claims, secret, now);
  assert.equal(verifyHandoff(token, secret, new Date(now.getTime() + 10 * 60_000)).ok, false);
  assert.equal(verifyHandoff(token, 'other', now).ok, false);
  const [body, sig] = token.split('.');
  const forged = `${Buffer.from(JSON.stringify({ ...claims, sub: 'admin', iat: 1, exp: 9e9 })).toString('base64url')}.${sig}`;
  assert.deepEqual(verifyHandoff(forged, secret, now), { ok: false, reason: 'BAD_SIGNATURE' });
  assert.equal(verifyHandoff(body, secret, now).ok, false);
  assert.equal(verifyHandoff('', secret, now).ok, false);
});

test('a result signature covers the timestamp and the exact body, and goes stale', () => {
  const body = JSON.stringify({ externalId: 'x' });
  const ts = Math.floor(now.getTime() / 1000);
  const sig = signResultBody(body, secret, ts);
  assert.deepEqual(verifyResultSignature({ rawBody: body, secret, signature: sig, timestamp: ts, now }), { ok: true });
  assert.equal(verifyResultSignature({ rawBody: body + ' ', secret, signature: sig, timestamp: ts, now }).ok, false);
  assert.equal(verifyResultSignature({ rawBody: body, secret, signature: sig, timestamp: ts, now: new Date(now.getTime() + 20 * 60_000) }).ok, false);
  assert.equal(verifyResultSignature({ rawBody: body, secret, signature: null, timestamp: ts, now }).ok, false);
});

test('a result payload is checked field by field', () => {
  const good = parseResultPayload({
    externalId: 'att-9',
    userId: 'u1',
    title: 'B1 telc mock test',
    level: 'B1',
    scorePercent: 71.5,
    passed: true,
    takenAt: '2026-09-11T09:30:00Z',
    certificateUrl: 'https://telc.medcitylms.in/cert/att-9',
    modules: [{ name: 'Hören', score: 18, max: 25 }, { name: 'Lesen', score: 20, max: 25 }],
  });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.result.modules?.length, 2);
    assert.equal(good.result.certificateUrl, 'https://telc.medcitylms.in/cert/att-9');
  }
  assert.equal(parseResultPayload({ userId: 'u1', title: 't', takenAt: '2026-01-01' }).ok, false);
  assert.equal(parseResultPayload({ externalId: 'a', userId: 'u1', title: 't', takenAt: 'yesterday' }).ok, false);
  assert.equal(parseResultPayload({ externalId: 'a', userId: 'u1', title: 't', takenAt: '2026-01-01', scorePercent: 140 }).ok, false);
  const http = parseResultPayload({ externalId: 'a', userId: 'u1', title: 't', takenAt: '2026-01-01', certificateUrl: 'http://x' });
  assert.equal(http.ok && http.result.certificateUrl, null);
});
