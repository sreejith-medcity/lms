import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSTER_TARGETS, posterTarget } from '../src/lib/qr-targets';
import { scannable, shortUrl } from '../src/lib/qr-sheet';

/**
 * A printed code carries the academy's mark, so where it leads is checked
 * here: one of the site's own doors, or a path on the academy's host, and
 * never another site however the path is spelt.
 */

test('a named door opens the right page on the academy host, with its own words when none are given', () => {
  const t = posterTarget('demo.medcitylms.in', { to: 'signup', path: '', heading: '', line: '' });
  assert.equal(t?.url, 'https://demo.medcitylms.in/signup');
  assert.equal(t?.heading, 'Join us');
  assert.match(t?.line ?? '', /learner account/);
  assert.equal(t?.slug, 'signup');
});

test('the academy can put its own words on it, trimmed to size', () => {
  const t = posterTarget('demo.medcitylms.in:443', { to: 'enquire', path: '', heading: '  Talk to us  ', line: 'x'.repeat(400) });
  assert.equal(t?.url, 'https://demo.medcitylms.in/contact');
  assert.equal(t?.heading, 'Talk to us');
  assert.equal(t?.line.length, 160);
});

test('another page on this site must be a plain path, never another host', () => {
  const ok = posterTarget('demo.medcitylms.in', { to: 'path', path: '/course/german-a1?utm=poster', heading: '', line: '' });
  assert.equal(ok?.url, 'https://demo.medcitylms.in/course/german-a1?utm=poster');
  assert.equal(ok?.slug, 'course-german-a1-utm-poster');
  for (const bad of ['https://evil.example/x', '//evil.example/x', 'course/german', '/x@evil.example', '/x\nSet-Cookie: a=b', '']) {
    assert.equal(posterTarget('demo.medcitylms.in', { to: 'path', path: bad, heading: '', line: '' }), null, `refused: ${JSON.stringify(bad)}`);
  }
  assert.equal(posterTarget('demo.medcitylms.in', { to: 'elsewhere', path: '/x', heading: '', line: '' }), null, 'an unknown door is refused');
  assert.equal(posterTarget('bad host', { to: 'signup', path: '', heading: '', line: '' }), null, 'a host that is not a hostname is refused');
});

test('every named door has a path, a heading and a line, except the free-path one', () => {
  for (const t of POSTER_TARGETS) {
    if (t.key === 'path') continue;
    assert.match(t.path, /^\//, t.key);
    assert.ok(t.heading && t.line, t.key);
  }
});

test('the brand colour is used for the code only when a scanner can read it against white', () => {
  assert.equal(scannable('#322046'), true, 'Medcity purple');
  assert.equal(scannable('#000000'), true);
  assert.equal(scannable('#ffd166'), false, 'a pale yellow would not scan');
  assert.equal(scannable('#ffffff'), false);
});

test('an address is printed the way people read it out', () => {
  assert.equal(shortUrl('https://demo.medcitylms.in/signup/'), 'demo.medcitylms.in/signup');
  assert.equal(shortUrl('http://x.test'), 'x.test');
});
