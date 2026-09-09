import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePath, parseRules } from '../src/lib/paths';

/**
 * The migration's one irreversible step, so its parsing gets the most tests.
 * Every case here is a shape a real WordPress site or a real spreadsheet
 * produces, not a shape invented to make the code look correct.
 */

test('a path is one shape however it was written', () => {
  assert.equal(normalisePath('/courses/ielts'), '/courses/ielts');
  assert.equal(normalisePath('/Courses/IELTS/'), '/courses/ielts');
  assert.equal(normalisePath('courses/ielts'), '/courses/ielts');
  assert.equal(normalisePath('  /courses//ielts/  '), '/courses/ielts');
  assert.equal(normalisePath('/courses/ielts?ref=fb'), '/courses/ielts');
  assert.equal(normalisePath('/courses/ielts#syllabus'), '/courses/ielts');
});

test('a pasted full URL is reduced to its path', () => {
  assert.equal(
    normalisePath('https://medcitylms.in/shop/ielts-kochi/'),
    '/shop/ielts-kochi',
  );
});

test('the root keeps its slash', () => {
  assert.equal(normalisePath('/'), '/');
  assert.equal(normalisePath(''), '/');
});

test('rules are read from commas, tabs or spaces', () => {
  const rules = parseRules(
    ['/shop/a, /courses/a', '/shop/b\t/courses/b', '/shop/c /courses/c'].join('\n'),
  );
  assert.equal(rules.length, 3);
  assert.deepEqual(
    rules.map((r) => r.toPath),
    ['/courses/a', '/courses/b', '/courses/c'],
  );
});

test('blank lines and comments are ignored, not reported as errors', () => {
  const rules = parseRules('\n# old store\n/shop/a, /courses/a\n\n');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].error, undefined);
});

test('a wildcard keeps its star on both sides', () => {
  const [rule] = parseRules('/shop/*, /courses/*');
  assert.equal(rule.fromPath, '/shop/*');
  assert.equal(rule.toPath, '/courses/*');
});

test('a rule pointing at itself is refused rather than looping', () => {
  const [rule] = parseRules('/courses/ielts, /courses/ielts/');
  assert.ok(rule.error, 'expected a reason, got none');
});

test('a line with only one path comes back with a reason, not dropped', () => {
  const rules = parseRules('/shop/orphan');
  assert.equal(rules.length, 1);
  assert.ok(rules[0].error);
});

test('an unknown status falls back to permanent, and 302 is kept', () => {
  assert.equal(parseRules('/a, /b, 999')[0].statusCode, 301);
  assert.equal(parseRules('/a, /b, 302')[0].statusCode, 302);
});
