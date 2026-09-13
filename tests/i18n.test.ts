import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fill, offeredLocales, pickLocale, translate } from '../src/lib/i18n/index';
import { CATALOGUE } from '../src/lib/i18n/catalogue';

test('the offered list always has English and only known codes', () => {
  assert.deepEqual(offeredLocales('ml, hi'), ['en', 'ml', 'hi']);
  assert.deepEqual(offeredLocales('hi,xx,en'), ['en', 'hi']);
  assert.deepEqual(offeredLocales(''), ['en']);
});

test('a choice outside the offered list falls back to English', () => {
  assert.equal(pickLocale('ml', ['en', 'ml']), 'ml');
  assert.equal(pickLocale('hi', ['en', 'ml']), 'en');
  assert.equal(pickLocale(undefined, ['en', 'ml']), 'en');
});

test('translation fills variables and falls back to the English text', () => {
  assert.equal(translate('ml', 'Fees'), 'ഫീസ്');
  assert.equal(translate('hi', 'Pay {{amount}} now', { amount: '₹500' }), '₹500 अभी चुकाएँ');
  assert.equal(translate('ml', 'A string nobody translated'), 'A string nobody translated');
  assert.equal(fill('Hello, {{name}}', {}), 'Hello, {{name}}');
});

test('both catalogues cover the same keys', () => {
  const ml = Object.keys(CATALOGUE.ml).sort();
  const hi = Object.keys(CATALOGUE.hi).sort();
  assert.deepEqual(ml, hi);
  for (const key of ml) {
    const vars = (key.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const lang of ['ml', 'hi'] as const) {
      assert.deepEqual((CATALOGUE[lang][key].match(/\{\{\w+\}\}/g) ?? []).sort(), vars, `${lang}: ${key}`);
    }
  }
});
