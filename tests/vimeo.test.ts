import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedDomains, idFromUri, LOCKED_PLAYER_PARAMS, lockedEmbedUrl, parseVimeoId, vimeoState } from '../src/lib/video/vimeo-rules';

test('a Vimeo id is read from whatever gets pasted', () => {
  assert.equal(parseVimeoId('123456789'), '123456789');
  assert.equal(parseVimeoId('https://vimeo.com/123456789'), '123456789');
  assert.equal(parseVimeoId('https://vimeo.com/123456789/abcdef1234'), '123456789');
  assert.equal(parseVimeoId('https://player.vimeo.com/video/123456789?h=abc'), '123456789');
  assert.equal(parseVimeoId('https://vimeo.com/manage/videos/123456789'), '123456789');
  assert.equal(parseVimeoId('https://vimeo.com/channels/staffpicks/123456789'), '123456789');
  assert.equal(parseVimeoId('/videos/123456789'), '123456789');
  assert.equal(parseVimeoId('https://youtube.com/watch?v=abc'), null);
  assert.equal(parseVimeoId('hello'), null);
  assert.equal(idFromUri('/videos/42424242'), '42424242');
  assert.equal(idFromUri(undefined), null);
});

test('Vimeo status maps to ours', () => {
  assert.equal(vimeoState('available', 'complete'), 'READY');
  assert.equal(vimeoState('available', undefined), 'READY');
  assert.equal(vimeoState('available', 'in_progress'), 'PROCESSING');
  assert.equal(vimeoState('transcoding', 'in_progress'), 'PROCESSING');
  assert.equal(vimeoState('uploading', undefined), 'QUEUED');
  assert.equal(vimeoState('transcoding_error', 'error'), 'FAILED');
  assert.equal(vimeoState('quota_exceeded', undefined), 'FAILED');
});

test('the player address carries the lock, keeps the privacy hash, and has no settings menu or right-click menu', () => {
  const url = new URL(lockedEmbedUrl({ id: '123', playerEmbedUrl: 'https://player.vimeo.com/video/123?h=abc123', color: '#087447' }));
  assert.equal(url.searchParams.get('h'), 'abc123');
  for (const [k, v] of Object.entries(LOCKED_PLAYER_PARAMS)) assert.equal(url.searchParams.get(k), v, k);
  assert.equal(url.searchParams.get('speed'), '0');
  assert.equal(url.searchParams.get('quality_selector'), '0');
  assert.equal(url.searchParams.get('disable_context_menu'), '1');
  assert.equal(url.searchParams.get('fullscreen'), '1');
  assert.equal(url.searchParams.get('color'), '087447');
  const own = new URL(lockedEmbedUrl({ id: '123', playerEmbedUrl: 'https://evil.example/video/123', fullscreen: false }));
  assert.equal(own.origin + own.pathname, 'https://player.vimeo.com/video/123');
  assert.equal(own.searchParams.get('fullscreen'), '0');
});

test('videos may play only on real academy addresses', () => {
  assert.deepEqual(embedDomains(['medcitylms.com', 'WWW.medcitylms.com', 'medcity.localhost', 'localhost:3000', 'demo.medcitylms.in:443', 'medcitylms.com', '[www.x](https://x)']), ['demo.medcitylms.in', 'medcitylms.com', 'www.medcitylms.com']);
});
