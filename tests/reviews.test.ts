import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canReview,
  inviteCopy,
  publishOnArrival,
  replyProblem,
  reviewProblem,
  reviewSummary,
  reviewerBadge,
} from '../src/lib/reviews';

test('a learner is asked once they reach the threshold, and the threshold is clamped', () => {
  assert.equal(canReview(24, 25), false);
  assert.equal(canReview(25, 25), true);
  assert.equal(canReview(100, 100), true);
  assert.equal(canReview(99, 100), false);
  assert.equal(canReview(0, -5), true);
  assert.equal(canReview(100, 150), true);
});

test('publish on arrival follows the mode', () => {
  assert.equal(publishOnArrival('REVIEW', 5), false);
  assert.equal(publishOnArrival('FOUR_UP', 4), true);
  assert.equal(publishOnArrival('FOUR_UP', 3), false);
  assert.equal(publishOnArrival('ALL', 1), true);
  assert.equal(publishOnArrival('nonsense', 5), false);
});

test('a review needs a whole-star rating and a sentence', () => {
  assert.equal(reviewProblem(0, 'Great course, well taught.'), 'Pick a rating first.');
  assert.equal(reviewProblem(4.5, 'Great course, well taught.'), 'Pick a rating first.');
  assert.equal(reviewProblem(5, 'Nice'), 'Tell us a little more than that.');
  assert.equal(reviewProblem(5, 'Great course, well taught.'), null);
  assert.match(reviewProblem(5, 'x'.repeat(1201)) ?? '', /under 1200/);
  assert.equal(replyProblem(''), null);
  assert.match(replyProblem('y'.repeat(1001)) ?? '', /under 1000/);
});

test('the summary averages to one decimal and fills five bars', () => {
  const s = reviewSummary([
    { rating: 5, count: 6 },
    { rating: 4, count: 3 },
    { rating: 2, count: 1 },
  ]);
  assert.equal(s.count, 10);
  assert.equal(s.average, 4.4);
  assert.deepEqual(s.bars.map((b) => [b.stars, b.count, b.percent]), [[5, 6, 60], [4, 3, 30], [3, 0, 0], [2, 1, 10], [1, 0, 0]]);
  assert.equal(s.recommendPercent, 90);
});

test('an empty summary is all zeros, and half ratings round to a bar', () => {
  const empty = reviewSummary([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.average, 0);
  assert.equal(empty.recommendPercent, 0);
  const halves = reviewSummary([{ rating: 4.5, count: 2 }]);
  assert.equal(halves.bars[0].count, 2);
  assert.equal(halves.average, 4.5);
});

test('the invitation says why now', () => {
  assert.equal(inviteCopy(100, 'German A1').title, 'You finished German A1');
  const mid = inviteCopy(42.4, 'German A1');
  assert.equal(mid.title, 'How is German A1 going?');
  assert.match(mid.body, /42% through/);
});

test('a card says who wrote it without naming anybody', () => {
  assert.equal(reviewerBadge({ userId: null, progressAtReview: null }), null);
  assert.equal(reviewerBadge({ userId: 'u1', progressAtReview: 40 }), 'Verified learner');
  assert.equal(reviewerBadge({ userId: 'u1', progressAtReview: 100 }), 'Completed the course');
  assert.equal(reviewerBadge({ userId: 'u1', progressAtReview: null }), 'Verified learner');
});
