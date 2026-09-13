import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVerdict } from '../src/lib/captcha-verdict';

test('recaptcha v3 passes on a good score for the right action, and refuses otherwise', () => {
  assert.deepEqual(readVerdict('recaptcha', { success: true, score: 0.9, action: 'enquiry' }, 'enquiry', 0.5), { ok: true, score: 0.9 });
  assert.equal(readVerdict('recaptcha', { success: true, score: 0.2, action: 'enquiry' }, 'enquiry', 0.5).ok, false);
  assert.equal(readVerdict('recaptcha', { success: true, score: 0.9, action: 'signup' }, 'enquiry', 0.5).ok, false);
  assert.match(readVerdict('recaptcha', { success: false, 'error-codes': ['timeout-or-duplicate'] }, 'enquiry', 0.5).reason ?? '', /timeout/);
});

test('turnstile passes on success and the matching action', () => {
  assert.deepEqual(readVerdict('turnstile', { success: true, action: 'signup' }, 'signup', 0.5), { ok: true });
  assert.deepEqual(readVerdict('turnstile', { success: true }, 'signup', 0.5), { ok: true });
  assert.equal(readVerdict('turnstile', { success: true, action: 'other' }, 'signup', 0.5).ok, false);
  assert.equal(readVerdict('turnstile', { success: false }, 'signup', 0.5).ok, false);
});
