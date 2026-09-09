import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, variablesIn, orderedVariables, asHtml } from '../src/lib/messaging/render';

/**
 * The rule this file exists to protect: a variable with nothing to fill it is
 * an error, not an empty string. "Hi ," to four hundred people is always caused
 * by rendering being forgiving.
 */

test('a missing variable is reported rather than rendered blank', () => {
  const out = render({ body: 'Hi {{name}}, {{title}} is at {{time}}.' }, { name: 'Sree' });
  assert.deepEqual(out.missing.sort(), ['time', 'title']);
});

test('an empty string counts as missing, not as filled', () => {
  const out = render({ body: 'Hi {{name}}.' }, { name: '' });
  assert.deepEqual(out.missing, ['name']);
});

test('nothing is missing when everything is supplied', () => {
  const out = render({ subject: '{{title}}', body: 'Hi {{name}}.' }, { name: 'Sree', title: 'IELTS' });
  assert.deepEqual(out.missing, []);
  assert.equal(out.body, 'Hi Sree.');
  assert.equal(out.subject, 'IELTS');
});

test('whitespace inside the braces is tolerated', () => {
  const out = render({ body: 'Hi {{ name }}.' }, { name: 'Sree' });
  assert.equal(out.body, 'Hi Sree.');
  assert.deepEqual(out.missing, []);
});

test('a variable used twice is listed once', () => {
  assert.deepEqual(variablesIn('{{a}} and {{a}} and {{b}}'), ['a', 'b']);
});

test('ordered variables follow the template, which is what Indian providers want', () => {
  assert.deepEqual(
    orderedVariables('{{code}} expires in {{minutes}}', { minutes: '10', code: '123456' }),
    ['123456', '10'],
  );
});

test('html escapes anything that came from a name field', () => {
  const html = asHtml('Hi <script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
