import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicOrigin } from '../src/lib/http-headers';

const req = (url: string, headers: Record<string, string>) => new Request(url, { headers });

test('behind a proxy the forwarded host wins over the listening address', () => {
  assert.equal(
    publicOrigin(req('https://0.0.0.0:3000/x', { host: '0.0.0.0:3000', 'x-forwarded-host': 'demo.medcitylms.in', 'x-forwarded-proto': 'https' })),
    'https://demo.medcitylms.in',
  );
});

test('the Host header is enough on its own, and is https unless local', () => {
  assert.equal(publicOrigin(req('https://0.0.0.0:3000/x', { host: 'demo.medcitylms.in' })), 'https://demo.medcitylms.in');
  assert.equal(publicOrigin(req('http://localhost:3000/x', { host: 'localhost:3000' })), 'http://localhost:3000');
});

test('a bare process address falls back to the request itself', () => {
  assert.equal(publicOrigin(req('http://0.0.0.0:3000/x', { host: '0.0.0.0:3000' })), 'http://0.0.0.0:3000');
});
