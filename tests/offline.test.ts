import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenceUntil, offlineVerdict, sizeLabel } from '../src/lib/offline';

const ok = { type: 'VIDEO', isDownloadable: true, hasFile: true, drmProtected: false, locked: false };

test('a lesson goes offline only when the academy allows it and it is a file that has opened', () => {
  assert.equal(offlineVerdict(ok), 'OFFERED');
  assert.equal(offlineVerdict({ ...ok, type: 'PDF' }), 'OFFERED');
  assert.equal(offlineVerdict({ ...ok, isDownloadable: false }), 'NOT_DOWNLOADABLE');
  assert.equal(offlineVerdict({ ...ok, hasFile: false }), 'NOT_A_FILE');
  for (const type of ['YOUTUBE', 'TEXT_HTML', 'SCORM', 'LINK_EMBED', 'LIVE_SESSION', 'ASSESSMENT']) assert.equal(offlineVerdict({ ...ok, type }), 'NOT_A_FILE', type);
  assert.equal(offlineVerdict({ ...ok, drmProtected: true }), 'PROTECTED');
  assert.equal(offlineVerdict({ ...ok, locked: true }), 'LOCKED');
});

test('a download is good for a week at a time', () => {
  assert.equal(licenceUntil(new Date('2026-10-20T00:00:00Z')).toISOString(), '2026-10-27T00:00:00.000Z');
  assert.equal(licenceUntil(new Date('2026-10-20T00:00:00Z'), 1).toISOString(), '2026-10-21T00:00:00.000Z');
});

test('sizes read naturally', () => {
  assert.equal(sizeLabel(0), '');
  assert.equal(sizeLabel(500), '1 KB');
  assert.equal(sizeLabel(250 * 1024), '250 KB');
  assert.equal(sizeLabel(12.4 * 1024 * 1024), '12.4 MB');
  assert.equal(sizeLabel(3 * 1024 * 1024 * 1024), '3.00 GB');
});
