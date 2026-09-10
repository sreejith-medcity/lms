import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageName } from '../src/lib/language';

/**
 * A free text field that invited a code, and printed it. The course page
 * advertised a German course as taught in "de" until somebody looked at it.
 */

test('a bare code becomes the language a buyer would recognise', () => {
  assert.equal(languageName('de'), 'German');
  assert.equal(languageName('ml'), 'Malayalam');
  assert.equal(languageName('EN'), 'English');
  assert.equal(languageName('en-IN'), 'English');
  assert.equal(languageName('en_GB'), 'English');
});

test("an academy's own wording is left exactly as typed", () => {
  assert.equal(languageName('German'), 'German');
  assert.equal(languageName('Malayalam and English'), 'Malayalam and English');
  assert.equal(languageName('German, with Malayalam support'), 'German, with Malayalam support');
});

test('a short word that is not a code is not mangled', () => {
  // Five characters or fewer is the only window where a lookup happens, so a
  // real word of that length must still pass through untouched.
  assert.equal(languageName('Hindi'), 'Hindi');
  assert.equal(languageName('Tamil'), 'Tamil');
});

test('nothing in gives nothing out, rather than an empty badge', () => {
  assert.equal(languageName(null), null);
  assert.equal(languageName(undefined), null);
  assert.equal(languageName('   '), null);
});
