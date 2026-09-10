import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_ACCEPT, IMAGE_EXTENSIONS, IMAGE_MIME_TYPES } from '../src/lib/image-formats';
import { inferMimeType, inferType, securityHeadersFor } from '../src/lib/storage';

test('every image format we claim to accept is one the storage layer knows', () => {
  for (const ext of IMAGE_EXTENSIONS) {
    const name = `artwork.${ext}`;
    assert.equal(inferType(name), 'IMAGE', `${ext} was not classified as an image`);
    assert.notEqual(
      inferMimeType(name),
      'application/octet-stream',
      `${ext} has no mime type, so it would be served as a download`,
    );
  }
});

test('the accept list names types and extensions, because a picker may only know one', () => {
  for (const mime of IMAGE_MIME_TYPES) assert.ok(IMAGE_ACCEPT.includes(mime), `missing ${mime}`);
  for (const ext of IMAGE_EXTENSIONS) assert.ok(IMAGE_ACCEPT.includes(`.${ext}`), `missing .${ext}`);
  // The wildcard is what this replaced, and it is what leaves AVIF greyed out
  // in a picker on an operating system that has not heard of it.
  assert.ok(!IMAGE_ACCEPT.includes('image/*'));
});

test('an uploaded SVG cannot run a script from our own origin', () => {
  const headers = securityHeadersFor('image/svg+xml');
  const csp = headers['Content-Security-Policy'] ?? '';
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /sandbox/);
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'inline script must not be allowed');
});

test('nosniff is on everything, not only on the format we worried about', () => {
  for (const mime of ['image/png', 'video/mp4', 'application/pdf', 'image/svg+xml']) {
    assert.equal(securityHeadersFor(mime)['X-Content-Type-Options'], 'nosniff', mime);
  }
});

test('an ordinary image is not sandboxed, because that would break nothing but cost clarity', () => {
  assert.equal(securityHeadersFor('image/png')['Content-Security-Policy'], undefined);
});
