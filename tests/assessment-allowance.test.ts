import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attemptAllowance,
  poolState,
  type AttemptRecord,
} from '../src/lib/assessment-allowance';

const NOW = new Date('2026-09-11T10:00:00Z');
const rules = { maxAttempts: 2, opensAt: null, closesAt: null };
const attempts = (...statuses: AttemptRecord['status'][]) => statuses.map((status) => ({ status }));

test('a course test gives everybody the test’s own attempts', () => {
  const a = attemptAllowance({ rules, grant: null, includedInCourse: true, attempts: [], now: NOW });
  assert.deepEqual([a.ok, a.allowed, a.used, a.left], [true, 2, 0, 2]);
});

test('a test outside the course is refused until it is assigned', () => {
  const refused = attemptAllowance({ rules, grant: null, includedInCourse: false, attempts: [], now: NOW });
  assert.equal(refused.reason, 'NOT_YOURS');

  const granted = attemptAllowance({
    rules,
    grant: { isAssigned: true, extraAttempts: 0, opensAt: null, closesAt: null },
    includedInCourse: false,
    attempts: [],
    now: NOW,
  });
  assert.equal(granted.ok, true);
});

test('extra attempts are on top of the test’s own limit', () => {
  const a = attemptAllowance({
    rules,
    grant: { isAssigned: true, extraAttempts: 2, opensAt: null, closesAt: null },
    includedInCourse: true,
    attempts: attempts('SUBMITTED', 'SUBMITTED', 'EVALUATED'),
    now: NOW,
  });
  assert.deepEqual([a.allowed, a.used, a.left, a.ok], [4, 3, 1, true]);
});

test('a voided attempt does not count against them', () => {
  const a = attemptAllowance({
    rules,
    grant: null,
    includedInCourse: true,
    attempts: attempts('SUBMITTED', 'VOID'),
    now: NOW,
  });
  assert.equal(a.used, 1);
  assert.equal(a.ok, true);
});

test('an attempt in progress does count, so a second tab is not a second attempt', () => {
  const a = attemptAllowance({
    rules,
    grant: null,
    includedInCourse: true,
    attempts: attempts('SUBMITTED', 'IN_PROGRESS'),
    now: NOW,
  });
  assert.equal(a.left, 0);
  assert.equal(a.reason, 'NO_ATTEMPTS_LEFT');
});

test('a learner’s own window replaces the test’s, before and after', () => {
  const closed = { maxAttempts: 2, opensAt: null, closesAt: new Date('2026-09-01T00:00:00Z') };

  const everybody = attemptAllowance({ rules: closed, grant: null, includedInCourse: true, attempts: [], now: NOW });
  assert.equal(everybody.reason, 'CLOSED');

  const theirs = attemptAllowance({
    rules: closed,
    grant: {
      isAssigned: true,
      extraAttempts: 0,
      opensAt: null,
      closesAt: new Date('2026-09-30T00:00:00Z'),
    },
    includedInCourse: true,
    attempts: [],
    now: NOW,
  });
  assert.equal(theirs.ok, true, 'the exam is next week; the office reopened it for them');
});

test('a test that has not opened says so rather than counting attempts', () => {
  const a = attemptAllowance({
    rules: { maxAttempts: 2, opensAt: new Date('2026-10-01T00:00:00Z'), closesAt: null },
    grant: null,
    includedInCourse: true,
    attempts: [],
    now: NOW,
  });
  assert.equal(a.reason, 'NOT_OPEN_YET');
});

test('every refusal carries a sentence for the learner', () => {
  const cases = [
    attemptAllowance({ rules, grant: null, includedInCourse: false, attempts: [], now: NOW }),
    attemptAllowance({ rules, grant: null, includedInCourse: true, attempts: attempts('SUBMITTED', 'SUBMITTED'), now: NOW }),
  ];
  for (const c of cases) assert.ok((c.message ?? '').length > 12, c.reason);
});

test('a pool counts tests taken, not attempts made', () => {
  const grant = { allowance: 5, expiresAt: null };

  const second = poolState({
    grant,
    startedAssessmentIds: ['a', 'a', 'b'],
    assessmentId: 'c',
    now: NOW,
  });
  assert.equal(second.used, 2, 'two distinct tests out of five');
  assert.equal(second.ok, true);
});

test('a pool lets them carry on with one they already started', () => {
  const spent = poolState({
    grant: { allowance: 2, expiresAt: null },
    startedAssessmentIds: ['a', 'b'],
    assessmentId: 'a',
    now: NOW,
  });
  assert.equal(spent.ok, true);

  const newOne = poolState({
    grant: { allowance: 2, expiresAt: null },
    startedAssessmentIds: ['a', 'b'],
    assessmentId: 'c',
    now: NOW,
  });
  assert.equal(newOne.ok, false);
  assert.equal(newOne.reason, 'POOL_SPENT');
});

test('a pool allowance can expire', () => {
  const a = poolState({
    grant: { allowance: 5, expiresAt: new Date('2026-09-01T00:00:00Z') },
    startedAssessmentIds: [],
    assessmentId: 'a',
    now: NOW,
  });
  assert.equal(a.reason, 'POOL_EXPIRED');
});
