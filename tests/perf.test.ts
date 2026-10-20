import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_PATH, formatTable, median, quantile, summarise, type Sample } from '../src/lib/perf';

test('quantiles by nearest rank', () => {
  assert.equal(quantile([], 0.5), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(quantile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9), 90);
  assert.equal(quantile([1, 2], 0.9), 2);
});

const s = (path: string, ttfb: number, status = 200): Sample => ({ path, ttfb, total: ttfb + 10, bytes: 2048, status });

test('the first fetch is cold, the rest are summarised, the floor is taken off', () => {
  const samples = [s(FLOOR_PATH, 300), s('/', 900), s(FLOOR_PATH, 40), s('/', 150), s(FLOOR_PATH, 50), s('/', 170), s(FLOOR_PATH, 45), s('/', 160)];
  const { rows, floor } = summarise(samples);
  assert.equal(floor, 45);
  const home = rows.find((r) => r.path === '/')!;
  assert.equal(home.cold, 900);
  assert.equal(home.median, 160);
  assert.equal(home.page, 115);
  assert.equal(home.runs, 4);
  assert.equal(home.kb, 2);
  assert.equal(rows[0].path, FLOOR_PATH);
  assert.equal(rows[0].page, 0);
  assert.match(formatTable(rows, floor), /\(floor\)/);
});

test('a page never comes out faster than nothing', () => {
  const { rows } = summarise([s(FLOOR_PATH, 80), s(FLOOR_PATH, 80), s('/x', 60), s('/x', 60)]);
  assert.equal(rows.find((r) => r.path === '/x')!.page, 0);
});
