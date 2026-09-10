import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redirectResponse } from '../src/lib/http-headers';

/**
 * The bug this guards against was invisible in development and total in
 * production: every course thumbnail, the favicon and the home page
 * photograph were found, allowed and signed correctly, and then the browser
 * was sent to the address the Node process happened to be listening on.
 */

test('a same-origin target stays relative, so the browser resolves it itself', () => {
  const res = redirectResponse('/media/sig/org/2026/09/artwork.jpg');
  assert.equal(res.status, 302);
  const location = res.headers.get('Location');
  assert.equal(location, '/media/sig/org/2026/09/artwork.jpg');
  // The whole point: no scheme and no host, so nothing can name the wrong one.
  assert.ok(!/^https?:\/\//.test(location ?? ''), `Location gained an origin: ${location}`);
});

test('an absolute target is passed through untouched', () => {
  // A presigned bucket URL and an identity provider's authorize endpoint are
  // both genuinely elsewhere, and rewriting either would break them.
  const presigned = 'https://bucket.example.com/org/file.mp4?X-Amz-Signature=abc';
  assert.equal(redirectResponse(presigned).headers.get('Location'), presigned);
});

test('the caller keeps control of status and of caching', () => {
  const res = redirectResponse('/login?sso=unconfigured', {
    status: 307,
    headers: { 'Cache-Control': 'private, no-store' },
  });
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(res.headers.get('Location'), '/login?sso=unconfigured');
});

test('a query string and an encoded path survive intact', () => {
  const target = '/media/sig/org/2026/09/name%20with%20spaces.jpg?download=1';
  assert.equal(redirectResponse(target).headers.get('Location'), target);
});
