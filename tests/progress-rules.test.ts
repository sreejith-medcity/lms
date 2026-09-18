import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRetestRule, attendanceFigure, homeworkFigure, levelProgress, overallRating, parseRubric, trends, type Result } from '../src/lib/progress-rules';
import { parseBandsText, parseProgram } from '../src/lib/programs';

const d = (s: string) => new Date(`${s}T10:00:00Z`);

test('attendance counts present and late over classes with a final record; not recorded and excused are left out and named', () => {
  const f = attendanceFigure({
    sessions: [
      { id: '1', startsAt: d('2026-09-01'), status: 'PRESENT' },
      { id: '2', startsAt: d('2026-09-02'), status: 'LATE' },
      { id: '3', startsAt: d('2026-09-03'), status: 'ABSENT' },
      { id: '4', startsAt: d('2026-09-04'), status: null },
      { id: '5', startsAt: d('2026-09-05'), status: 'EXCUSED' },
    ],
  });
  assert.equal(f.held, 5);
  assert.equal(f.percent, 67);
  assert.equal(f.notRecorded, 1);
  assert.match(f.basis, /over 3 completed classes/);
  assert.match(f.basis, /1 not recorded, not counted/);
  assert.equal(attendanceFigure({ sessions: [{ id: '1', startsAt: d('2026-09-01'), status: null }] }).percent, null);
});

function r(over: { title: string; testDate: string; percent: number | null; category?: string; skill?: string | null }): Result {
  const category = over.category ?? 'Class Test';
  const skill = over.skill ?? null;
  return {
    sheetId: over.title + over.testDate,
    seriesKey: `${over.title}|${category}|${skill ?? ''}`,
    title: over.title,
    category,
    skill,
    level: null,
    testDate: d(over.testDate),
    percent: over.percent,
    passed: over.percent !== null ? over.percent >= 40 : null,
    grade: null,
    outcome: over.percent === null ? 'ABSENT' : 'SCORED',
    remark: null,
    version: 1,
  };
}

test('the retest rule picks one attempt per series and labels the others as retests', () => {
  const results = [r({ title: 'Unit 1', testDate: '2026-09-01', percent: 30 }), r({ title: 'Unit 1', testDate: '2026-09-10', percent: 70 }), r({ title: 'Unit 1', testDate: '2026-09-20', percent: 55 }), r({ title: 'Unit 2', testDate: '2026-09-15', percent: 80 })];
  const pick = (rule: 'FIRST' | 'LATEST' | 'BEST') => applyRetestRule(results, rule).counted.map((x) => x.percent).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepEqual(pick('LATEST'), [55, 80]);
  assert.deepEqual(pick('BEST'), [70, 80]);
  assert.deepEqual(pick('FIRST'), [30, 80]);
  assert.equal(applyRetestRule(results, 'LATEST').retests.length, 2);
});

test('trends keep kinds of test and skills apart and never average an absence in', () => {
  const t = trends(
    [
      r({ title: 'Reading 1', testDate: '2026-09-01', percent: 60, skill: 'Reading' }),
      r({ title: 'Reading 2', testDate: '2026-09-08', percent: 80, skill: 'Reading' }),
      r({ title: 'Mock', testDate: '2026-09-09', percent: 50, category: 'Mock Test' }),
      r({ title: 'Reading 3', testDate: '2026-09-15', percent: null, skill: 'Reading' }),
    ],
    'LATEST',
  );
  const reading = t.find((x) => x.label === 'Class Test · Reading')!;
  assert.equal(reading.points.length, 2);
  assert.equal(reading.average, 70);
  assert.ok(t.find((x) => x.label === 'Mock Test'));
  assert.match(reading.basis, /latest attempt counts/);
});

test('homework counts verified complete out of due, with awaiting shown apart', () => {
  const h = homeworkFigure({
    items: [
      { title: 'a', dueAt: null, verification: 'COMPLETE', handedIn: true, feedback: null },
      { title: 'b', dueAt: null, verification: null, handedIn: true, feedback: null },
      { title: 'c', dueAt: null, verification: 'RESUBMIT', handedIn: true, feedback: null },
      { title: 'd', dueAt: null, verification: null, handedIn: false, feedback: null },
    ],
  });
  assert.equal(h.due, 4);
  assert.equal(h.complete, 1);
  assert.equal(h.awaiting, 1);
  assert.equal(h.resubmit, 1);
  assert.equal(h.notSubmitted, 1);
});

test('no rubric means no rating; a rubric rescales around missing parts and says so', () => {
  assert.equal(overallRating(null, { attendancePercent: 90, testsAverage: 80, homework: null }), null);
  const rubric = parseRubric({ attendance: 30, tests: 50, homework: 20, bands: [{ label: 'Needs attention', minPercent: 0 }, { label: 'Good', minPercent: 70 }, { label: 'Excellent', minPercent: 85 }] })!;
  assert.ok(rubric);
  const full = overallRating(rubric, { attendancePercent: 90, testsAverage: 80, homework: { complete: 4, due: 4 } })!;
  assert.equal(full.percent, 87);
  assert.equal(full.label, 'Excellent');
  const partial = overallRating(rubric, { attendancePercent: 90, testsAverage: null, homework: null })!;
  assert.equal(partial.percent, 90);
  assert.match(partial.basis, /tests and homework left out/);
  assert.equal(overallRating(rubric, { attendancePercent: null, testsAverage: null, homework: null }), null);
  assert.equal(parseRubric({ attendance: 30, tests: 50, homework: 30, bands: [{ label: 'x', minPercent: 0 }] }), null);
  assert.equal(parseRubric({ attendance: 30, tests: 50, homework: 20, bands: [] }), null);
});

test('rubric bands are typed as label:minimum and must start at zero', () => {
  assert.deepEqual(parseBandsText('Excellent:85, Good:70, Needs attention:0'), [
    { label: 'Needs attention', minPercent: 0 },
    { label: 'Good', minPercent: 70 },
    { label: 'Excellent', minPercent: 85 },
  ]);
  assert.equal(parseBandsText('Good:70'), 'bad');
  assert.equal(parseBandsText(''), null);
  const base = { name: 'German', code: '', description: '', levels: 'A1, A2', skills: '', categories: 'Class Test', passPercent: '', retestRule: 'LATEST' };
  const noRubric = parseProgram(base);
  assert.ok(noRubric.ok && noRubric.value.ratingRubric === null);
  const bad = parseProgram({ ...base, ratingAttendance: '50', ratingTests: '30', ratingHomework: '30', ratingBands: 'Good:0' });
  assert.equal(bad.ok, false);
  const good = parseProgram({ ...base, ratingAttendance: '50', ratingTests: '30', ratingHomework: '20', ratingBands: 'Good:70, Weak:0', lateAfterMinutes: '15' });
  assert.ok(good.ok && good.value.ratingRubric?.bands.length === 2 && good.value.lateAfterMinutes === 15);
});

test('level progress reads the ladder from finished batches and the current one', () => {
  const l = levelProgress(['A1', 'A2', 'B1', 'B2'], ['A1'], 'A2');
  assert.deepEqual(l.completed, ['A1']);
  assert.deepEqual(l.remaining, ['B1', 'B2']);
  assert.equal(l.current, 'A2');
  assert.equal(levelProgress([], [], null).basis, 'The program has no levels.');
});
