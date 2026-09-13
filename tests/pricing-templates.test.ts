import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTemplate, parseShares, scheduleFromTemplate, sharesProblem, templateProblem } from '../src/lib/pricing-templates';

test('shares parse from whatever separator the office typed', () => {
  assert.deepEqual(parseShares('40, 30, 30'), [40, 30, 30]);
  assert.deepEqual(parseShares('50/25/25'), [50, 25, 25]);
  assert.deepEqual(parseShares('40% 60%'), [40, 60]);
  assert.deepEqual(parseShares(''), []);
});

test('shares must match the count and add to 100', () => {
  assert.equal(sharesProblem([], 3), null);
  assert.equal(sharesProblem([40, 30, 30], 3), null);
  assert.equal(sharesProblem([40, 60], 3), 'The shares name 2 parts but the plan has 3.');
  assert.equal(sharesProblem([40, 30, 20], 3), 'The shares add up to 90%, not 100%.');
});

test('equal parts carry the odd paise on the first; shares weight the parts', () => {
  const equal = scheduleFromTemplate(1_000_000, { instalmentCount: 3, gapDays: 30, shares: [] });
  assert.deepEqual(equal.map((p) => p.amountPaise), [333_334, 333_333, 333_333]);
  assert.deepEqual(equal.map((p) => p.dueOffsetDays), [0, 30, 60]);
  const weighted = scheduleFromTemplate(1_000_000, { instalmentCount: 3, gapDays: 45, shares: [50, 25, 25] });
  assert.deepEqual(weighted.map((p) => p.amountPaise), [500_000, 250_000, 250_000]);
  assert.deepEqual(weighted.map((p) => p.dueOffsetDays), [0, 45, 90]);
  assert.equal(weighted.reduce((n, p) => n + p.amountPaise, 0), 1_000_000);
});

test('a template reads as one line', () => {
  assert.equal(
    describeTemplate({ planType: 'INSTALMENT', instalmentCount: 3, gapDays: 30, shares: [40, 30, 30], validityDays: 365, invoiceAnchor: 'CLASS_COMMENCEMENT' }),
    '3 parts of 40/30/30, 30 days apart from the batch start, access for a year',
  );
  assert.equal(
    describeTemplate({ planType: 'ONE_TIME', instalmentCount: 1, gapDays: 30, shares: [], validityDays: null, invoiceAnchor: 'ENROLLMENT' }),
    'paid in full, once, access does not expire',
  );
});

test('template problems are named', () => {
  assert.equal(templateProblem({ name: 'Standard', planType: 'INSTALMENT', instalmentCount: 3, gapDays: 30, shares: [] }), null);
  assert.equal(templateProblem({ name: 'S', planType: 'INSTALMENT', instalmentCount: 3, gapDays: 30, shares: [] }), 'Give the template a name.');
  assert.equal(templateProblem({ name: 'Standard', planType: 'INSTALMENT', instalmentCount: 1, gapDays: 30, shares: [] }), 'An instalment plan has between 2 and 24 parts.');
});
