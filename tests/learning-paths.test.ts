import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockedMessage,
  bundleProblem,
  bundleSaving,
  checkPrerequisites,
  pathTo,
  prerequisiteLabel,
  slugify,
  unlockedBy,
  wouldLoop,
} from '../src/lib/learning-paths';

const a1 = { requiredCourseId: 'a1', requiredTitle: 'German A1', minProgressPercent: 100 };
const a2 = { requiredCourseId: 'a2', requiredTitle: 'German A2', minProgressPercent: 50 };

test('a prerequisite is met at the progress it asks for, and never without an enrolment', () => {
  assert.equal(checkPrerequisites([a1], new Map([['a1', 100]])).met, true);
  assert.equal(checkPrerequisites([a1], new Map([['a1', 99]])).met, false);
  assert.equal(checkPrerequisites([a1], new Map()).met, false);
  assert.equal(checkPrerequisites([a2], new Map([['a2', 50]])).met, true);
  assert.equal(checkPrerequisites([{ ...a1, minProgressPercent: 0 }], new Map([['a1', 0]])).met, true);
  assert.equal(checkPrerequisites([{ ...a1, minProgressPercent: 0 }], new Map()).met, false);
  assert.equal(checkPrerequisites([], new Map()).met, true);
});

test('the missing list says what is needed and what they have', () => {
  const check = checkPrerequisites([a1, a2], new Map([['a2', 20]]));
  assert.deepEqual(check.missing, [
    { requiredCourseId: 'a1', requiredTitle: 'German A1', need: 100, have: null },
    { requiredCourseId: 'a2', requiredTitle: 'German A2', need: 50, have: 20 },
  ]);
  assert.equal(
    blockedMessage(check),
    'To take this course, first finish German A1 and get 50% through German A2 (you are at 20%).',
  );
  assert.equal(blockedMessage(checkPrerequisites([], new Map())), null);
});

test('labels read as instructions', () => {
  assert.equal(prerequisiteLabel({ requiredTitle: 'A1', minProgressPercent: 100 }), 'Finish A1');
  assert.equal(prerequisiteLabel({ requiredTitle: 'A1', minProgressPercent: 60 }), 'Get 60% through A1');
  assert.equal(prerequisiteLabel({ requiredTitle: 'A1', minProgressPercent: 0 }), 'Be enrolled in A1');
});

test('a loop is refused, including a course needing itself', () => {
  const edges = [
    { courseId: 'a2', requiredCourseId: 'a1' },
    { courseId: 'b1', requiredCourseId: 'a2' },
  ];
  assert.equal(wouldLoop(edges, 'a1', 'a1'), true);
  assert.equal(wouldLoop(edges, 'a1', 'b1'), true);
  assert.equal(wouldLoop(edges, 'a1', 'a2'), true);
  assert.equal(wouldLoop(edges, 'b2', 'b1'), false);
  assert.equal(wouldLoop(edges, 'a2', 'b2'), false);
});

test('the path to a course lists what it needs first, once each, then the course', () => {
  const edges = [
    { courseId: 'a2', requiredCourseId: 'a1' },
    { courseId: 'b1', requiredCourseId: 'a2' },
    { courseId: 'b1', requiredCourseId: 'a1' },
  ];
  assert.deepEqual(pathTo(edges, 'b1'), ['a1', 'a2', 'b1']);
  assert.deepEqual(pathTo(edges, 'a1'), ['a1']);
  assert.deepEqual(unlockedBy(edges, 'a1'), ['a2', 'b1']);
  assert.deepEqual(unlockedBy(edges, 'b1'), []);
});

test('a bundle saving is against the courses bought one by one', () => {
  const s = bundleSaving(1500000, [700000, 700000, 400000]);
  assert.equal(s.separatelyPaise, 1800000);
  assert.equal(s.savingPaise, 300000);
  assert.equal(s.savingPercent, 17);
  assert.deepEqual(bundleSaving(1000, [500]), { separatelyPaise: 500, savingPaise: 0, savingPercent: 0 });
  assert.deepEqual(bundleSaving(0, []), { separatelyPaise: 0, savingPaise: 0, savingPercent: 0 });
});

test('a bundle needs a name and at least two distinct courses', () => {
  assert.equal(bundleProblem('', ['a', 'b']), 'Give the bundle a name.');
  assert.equal(bundleProblem('German A1 + A2', ['a', 'a']), 'A bundle needs at least two courses.');
  assert.equal(bundleProblem('German A1 + A2', ['a', 'b']), null);
  assert.equal(slugify('German A1 + A2 (evening)'), 'german-a1-a2-evening');
  assert.equal(slugify('!!!'), 'bundle');
});
