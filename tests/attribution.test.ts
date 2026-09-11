import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attributionForOrder,
  captureAttribution,
  describeAttribution,
  fbpFrom,
  gaClientIdFrom,
  parseAttribution,
  serialiseAttribution,
  touchFromUrl,
} from '../src/lib/attribution';

const now = new Date('2026-09-11T10:00:00Z');

test('a tagged landing is a touch; a plain visit from nowhere is not', () => {
  const t = touchFromUrl(new URL('https://demo.medcitylms.in/nclex-rn-course?gclid=abc&utm_campaign=kochi'), null, now);
  assert.equal(t?.gclid, 'abc');
  assert.equal(t?.utm_campaign, 'kochi');
  assert.equal(t?.landing, '/nclex-rn-course?gclid=abc&utm_campaign=kochi');
  assert.equal(touchFromUrl(new URL('https://demo.medcitylms.in/'), null, now), null);
  assert.equal(touchFromUrl(new URL('https://demo.medcitylms.in/'), 'https://demo.medcitylms.in/courses', now), null);
});

test('a referral from elsewhere counts, with the hostname only', () => {
  const t = touchFromUrl(new URL('https://demo.medcitylms.in/'), 'https://www.google.com/search?q=nclex', now);
  assert.equal(t?.referrer, 'www.google.com');
  assert.equal(t?.gclid, undefined);
});

test('first touch is kept, last touch moves, and a plain referral does not overwrite a paid click', () => {
  const first = captureAttribution(new URL('https://x.in/?fbclid=F1&utm_source=facebook'), null, null, now);
  assert.ok(first);
  const cookie = serialiseAttribution(first);

  const later = new Date(now.getTime() + 864e5);
  const second = captureAttribution(new URL('https://x.in/ielts?gclid=G2'), null, cookie, later);
  assert.equal(second?.first.fbclid, 'F1');
  assert.equal(second?.last.gclid, 'G2');

  const organic = captureAttribution(new URL('https://x.in/'), 'https://www.google.com/', serialiseAttribution(second!), later);
  assert.equal(organic, null);

  const fresh = captureAttribution(new URL('https://x.in/'), 'https://www.google.com/', null, later);
  assert.equal(fresh?.last.referrer, 'www.google.com');
});

test('the cookie parses back, encoded or not, and junk is null', () => {
  const a = captureAttribution(new URL('https://x.in/?gclid=1'), null, null, now)!;
  const raw = serialiseAttribution(a);
  assert.deepEqual(parseAttribution(raw), a);
  assert.deepEqual(parseAttribution(encodeURIComponent(raw)), a);
  assert.equal(parseAttribution('{"nope":1}'), null);
  assert.equal(parseAttribution('garbage'), null);
});

test('Meta and GA browser ids are read from their cookies', () => {
  const header = '_ga=GA1.1.1234567890.1700000000; _fbp=fb.1.1700000000000.987654321; other=x';
  assert.equal(fbpFrom(header), 'fb.1.1700000000000.987654321');
  assert.equal(gaClientIdFrom(header), '1234567890.1700000000');
  assert.equal(gaClientIdFrom('x=1'), undefined);
});

test('the order carries touches plus browser ids, or nothing at all', () => {
  const cookie = serialiseAttribution(captureAttribution(new URL('https://x.in/?gclid=1&utm_campaign=c'), null, null, now)!);
  const full = attributionForOrder({ attributionCookie: cookie, cookieHeader: '_fbp=fb.1.1.2', userAgent: 'UA' });
  assert.equal(full?.last.gclid, '1');
  assert.equal(full?.fbp, 'fb.1.1.2');
  assert.equal(full?.userAgent, 'UA');
  assert.equal(attributionForOrder({ attributionCookie: null, cookieHeader: '' }), null);
  assert.equal(describeAttribution(full), 'Google Ads · c');
  assert.equal(describeAttribution(null), 'Direct');
});
