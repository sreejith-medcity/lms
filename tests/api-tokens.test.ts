import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashRefreshToken, mintRefreshToken, readAccessToken, readHandoff, signAccessToken, signHandoff } from '../src/lib/api/tokens';
import { limited } from '../src/lib/api/limiter';

test('an access token round-trips and dies on expiry or tampering', () => {
  const t = signAccessToken({ sub: 'u1', org: 'o1', kind: 'LEARNER' }, 1_000_000_000_000, 60);
  const claims = readAccessToken(t, 1_000_000_000_000 + 30_000);
  assert.equal(claims?.sub, 'u1');
  assert.equal(claims?.org, 'o1');
  assert.equal(readAccessToken(t, 1_000_000_000_000 + 61_000), null);
  assert.equal(readAccessToken(t.slice(0, -2) + 'xx'), null);
  assert.equal(readAccessToken('nonsense'), null);
});

test('refresh tokens are random and only their hash is comparable', () => {
  const a = mintRefreshToken();
  const b = mintRefreshToken();
  assert.notEqual(a.token, b.token);
  assert.equal(hashRefreshToken(a.token), a.hash);
  assert.notEqual(hashRefreshToken(b.token), a.hash);
});

test('a handoff names a path on this site for two minutes', () => {
  const t = signHandoff('u1', '/learn/fees', 0);
  assert.deepEqual({ sub: readHandoff(t, 60_000)?.sub, path: readHandoff(t, 60_000)?.path }, { sub: 'u1', path: '/learn/fees' });
  assert.equal(readHandoff(t, 121_000), null);
  assert.equal(readHandoff(signHandoff('u1', '//evil.example', 0), 1000), null);
});

test('the limiter counts within a window and forgets after it', () => {
  const key = `k${Math.random()}`;
  assert.equal(limited(key, 2, 1000, 0), false);
  assert.equal(limited(key, 2, 1000, 10), false);
  assert.equal(limited(key, 2, 1000, 20), true);
  assert.equal(limited(key, 2, 1000, 2000), false);
});
