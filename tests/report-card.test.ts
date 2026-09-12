import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestAttempts, buildReportCard, latestGraded } from '../src/lib/report-card';
import { DEFAULT_BANDS } from '../src/lib/grading';

test('a report card averages tests and homework and names the grade', () => {
  const card = buildReportCard({
    attendance: { held: 20, attended: 17, late: 2 },
    tests: [{ title: 'Mock 1', percent: 72, passed: true, on: '1 Aug' }, { title: 'Mock 2', percent: 88.4, passed: true, on: '20 Aug' }],
    homework: [{ title: 'Letter', marks: 16, maxMarks: 20, on: '10 Aug' }],
    bands: DEFAULT_BANDS,
  });
  assert.equal(card.attendance.percent, 85);
  assert.equal(card.tests[1].grade, 'A');
  assert.equal(card.homework[0].percent, 80);
  assert.equal(card.homework[0].note, '16 / 20');
  assert.equal(card.overall.percent, 80.1);
  assert.equal(card.overall.grade, 'A');
  assert.equal(card.overall.label, 'Excellent');
});

test('nothing sat yet is null, not zero', () => {
  const card = buildReportCard({ attendance: { held: 0, attended: 0, late: 0 }, tests: [], homework: [], bands: DEFAULT_BANDS });
  assert.equal(card.attendance.percent, null);
  assert.equal(card.overall.percent, null);
  assert.equal(card.overall.grade, null);
});

test('the best attempt per paper and the latest hand-in per assignment are the ones that count', () => {
  const best = bestAttempts([
    { assessmentId: 'a', scorePercent: 40 },
    { assessmentId: 'a', scorePercent: 71 },
    { assessmentId: 'a', scorePercent: null },
    { assessmentId: 'b', scorePercent: 55 },
  ]);
  assert.deepEqual(best.map((b) => b.scorePercent), [71, 55]);
  const latest = latestGraded([{ assignmentId: 'x', attemptNo: 1 }, { assignmentId: 'x', attemptNo: 2 }, { assignmentId: 'y', attemptNo: 1 }]);
  assert.deepEqual(latest.map((l) => `${l.assignmentId}${l.attemptNo}`), ['x2', 'y1']);
});
