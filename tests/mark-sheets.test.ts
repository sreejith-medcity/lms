import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, computeEntry, diffVersions, editable, entryProblem, parseMark, reviewSheet, visibleToParents, type SheetRules } from '../src/lib/mark-sheets';
import { DEFAULT_BANDS } from '../src/lib/grading';

const rules: SheetRules = { maxMarks: 50, passPercent: 40, bands: DEFAULT_BANDS };

test('a scored line gets a percent, a grade and a pass; absent and not assessed get none', () => {
  const scored = computeEntry({ userId: 'a', outcome: 'SCORED', marks: 42.5, remark: null, override: null }, rules);
  assert.equal(scored.percent, 85);
  assert.equal(scored.grade, 'A');
  assert.equal(scored.passed, true);
  const fail = computeEntry({ userId: 'b', outcome: 'SCORED', marks: 10, remark: null, override: null }, rules);
  assert.equal(fail.percent, 20);
  assert.equal(fail.passed, false);
  const absent = computeEntry({ userId: 'c', outcome: 'ABSENT', marks: 30, remark: null, override: null }, rules);
  assert.equal(absent.marks, null);
  assert.equal(absent.percent, null);
  assert.equal(absent.passed, null);
  const na = computeEntry({ userId: 'd', outcome: 'NOT_ASSESSED', marks: null, remark: null, override: null }, rules);
  assert.equal(na.grade, null);
});

test('without a pass mark the grade scale decides; without either, nothing is said', () => {
  const byScale = computeEntry({ userId: 'a', outcome: 'SCORED', marks: 19, remark: null, override: null }, { maxMarks: 50, passPercent: null, bands: DEFAULT_BANDS });
  assert.equal(byScale.percent, 38);
  assert.equal(byScale.grade, 'F');
  assert.equal(byScale.passed, false);
  const bare = computeEntry({ userId: 'a', outcome: 'SCORED', marks: 19, remark: null, override: null }, { maxMarks: 50, passPercent: null, bands: [] });
  assert.equal(bare.grade, null);
  assert.equal(bare.passed, null);
});

test('marks are bounded by the maximum and never below zero; a blank is missing, not zero', () => {
  assert.equal(entryProblem({ userId: 'a', outcome: 'SCORED', marks: 51, remark: null, override: null }, rules), 'has 51, above the maximum of 50.');
  assert.equal(entryProblem({ userId: 'a', outcome: 'SCORED', marks: -1, remark: null, override: null }, rules), 'has a mark below zero.');
  assert.match(entryProblem({ userId: 'a', outcome: 'SCORED', marks: null, remark: null, override: null }, rules) ?? '', /has no mark/);
  assert.equal(entryProblem({ userId: 'a', outcome: 'ABSENT', marks: null, remark: null, override: null }, rules), null);
  assert.equal(parseMark(''), null);
  assert.equal(parseMark(' 12.345 '), 12.35);
  assert.equal(parseMark('twelve'), 'bad');
});

test('the review names who has no line and counts each outcome apart', () => {
  const roster = [
    { userId: 'a', name: 'Anjali' },
    { userId: 'b', name: 'Biju' },
    { userId: 'c', name: 'Chitra' },
    { userId: 'd', name: 'Deepak' },
  ];
  const r = reviewSheet(
    roster,
    [
      { userId: 'a', outcome: 'SCORED', marks: 45, remark: null, override: null },
      { userId: 'b', outcome: 'ABSENT', marks: null, remark: null, override: null },
      { userId: 'c', outcome: 'SCORED', marks: 60, remark: null, override: null },
    ],
    rules,
  );
  assert.equal(r.scored, 2);
  assert.equal(r.absent, 1);
  assert.equal(r.notAssessed, 0);
  assert.deepEqual(r.missing, ['Deepak']);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /Chitra has 60, above/);
  assert.equal(r.passed, 2);
});

test('a teacher submits a draft or a returned sheet; only an approver publishes or returns', () => {
  assert.equal(canTransition('DRAFT', 'SUBMITTED', 'teacher'), true);
  assert.equal(canTransition('RETURNED', 'SUBMITTED', 'teacher'), true);
  assert.equal(canTransition('DRAFT', 'PUBLISHED', 'teacher'), false);
  assert.equal(canTransition('SUBMITTED', 'PUBLISHED', 'teacher'), false);
  assert.equal(canTransition('SUBMITTED', 'PUBLISHED', 'approver'), true);
  assert.equal(canTransition('SUBMITTED', 'RETURNED', 'approver'), true);
  assert.equal(canTransition('DRAFT', 'PUBLISHED', 'approver'), false);
  assert.equal(canTransition('PUBLISHED', 'DRAFT', 'approver'), false);
  assert.equal(editable('DRAFT'), true);
  assert.equal(editable('RETURNED'), true);
  assert.equal(editable('SUBMITTED'), false);
  assert.equal(editable('PUBLISHED'), false);
});

test('parents see a published, current sheet and nothing else', () => {
  assert.equal(visibleToParents('PUBLISHED', null), true);
  assert.equal(visibleToParents('PUBLISHED', 'newer'), false);
  assert.equal(visibleToParents('SUBMITTED', null), false);
  assert.equal(visibleToParents('DRAFT', null), false);
  assert.equal(visibleToParents('RETURNED', null), false);
});

test('a correction shows what changed against the version it replaces', () => {
  const roster = [
    { userId: 'a', name: 'Anjali' },
    { userId: 'b', name: 'Biju' },
  ];
  const before = [computeEntry({ userId: 'a', outcome: 'SCORED', marks: 15, remark: null, override: null }, rules), computeEntry({ userId: 'b', outcome: 'ABSENT', marks: null, remark: null, override: null }, rules)];
  const after = [computeEntry({ userId: 'a', outcome: 'SCORED', marks: 30, remark: 'Improved', override: null }, rules), computeEntry({ userId: 'b', outcome: 'ABSENT', marks: null, remark: null, override: null }, rules)];
  const d = diffVersions(roster, before, after);
  assert.equal(d.length, 1);
  assert.equal(d[0].name, 'Anjali');
  assert.equal(d[0].before, '15 (F), fail');
  assert.equal(d[0].after, '30 (C); "Improved"');
});
