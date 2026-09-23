import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseAllowances, leftAt, levelOf, pickAllowance, standing, standingLine, type AllowanceRow } from '../src/lib/exams/allowance';
import { parseMarking, criteriaFor, taskTextOf } from '../src/lib/exams/marking';
import { TELC_B1, TELC_A1 } from '../src/lib/exams/formats/telc';

const now = new Date('2026-09-23T10:00:00Z');
const row = (o: Partial<AllowanceRow> & { id: string }): AllowanceRow => ({
  familyCode: 'telc',
  level: 'B1',
  tests: 3,
  used: 0,
  source: 'COURSE',
  expiresAt: null,
  revokedAt: null,
  ...o,
});

test('a sitting draws on the free sample first, then the course, a grant, and what was paid for last', () => {
  const rows = [row({ id: 'pack', source: 'PACK', tests: 10 }), row({ id: 'course' }), row({ id: 'sample', source: 'SAMPLE', tests: 1 }), row({ id: 'grant', source: 'GRANT', tests: 2 })];
  assert.equal(pickAllowance(rows, 'telc', 'B1', now)?.id, 'sample');
  rows[2].used = 1;
  assert.equal(pickAllowance(rows, 'telc', 'B1', now)?.id, 'course');
  rows[1].used = 3;
  assert.equal(pickAllowance(rows, 'telc', 'B1', now)?.id, 'grant');
});

test('a level of its own before an any-level allowance; a spent, revoked or expired one is passed over', () => {
  const rows = [
    row({ id: 'any', level: null, tests: 5 }),
    row({ id: 'b1' }),
    row({ id: 'spent', tests: 1, used: 1 }),
    row({ id: 'gone', revokedAt: now }),
    row({ id: 'old', expiresAt: new Date('2026-09-01') }),
  ];
  assert.equal(pickAllowance(rows, 'telc', 'B1', now)?.id, 'b1');
  assert.equal(pickAllowance(rows, 'telc', 'A2', now)?.id, 'any');
  assert.equal(pickAllowance(rows, 'ielts', null, now), null);
  assert.equal(leftAt(rows, 'telc', 'B1', now), 8);
  assert.equal(leftAt([row({ id: 'u', tests: null })], 'telc', 'B1', now), Infinity);
});

test('the standing per level adds the live allowances and says so in words', () => {
  const rows = [row({ id: 'a', tests: 3, used: 1 }), row({ id: 'b', source: 'PACK', tests: 5 }), row({ id: 'c', level: 'A1', tests: 1, used: 1 })];
  const s = standing(rows, 'telc', now);
  assert.deepEqual(s.map((x) => [x.level, x.left, x.used]), [['A1', 0, 1], ['B1', 7, 1]]);
  assert.equal(standingLine(s[1]), '7 left, 1 used');
  assert.equal(standingLine(s[0]), 'none left (1 used)');
  assert.equal(standingLine({ left: null, used: 2 }), 'unlimited');
});

test('a course that includes mock tests becomes an allowance at its level, or at any level when it names none', () => {
  const out = courseAllowances([
    { enrollmentId: 'e1', live: true, mockTestAttempts: 5, level: 'B1', title: 'German Language - B1' },
    { enrollmentId: 'e2', live: true, mockTestAttempts: null, level: null, title: 'IELTS' },
    { enrollmentId: 'e3', live: false, mockTestAttempts: 2, level: null, title: 'German for nurses' },
  ]);
  assert.deepEqual(out, [
    { enrollmentId: 'e1', familyCode: 'telc', level: 'B1', tests: 5, live: true },
    { enrollmentId: 'e3', familyCode: 'telc', level: null, tests: 2, live: false },
  ]);
  assert.equal(levelOf(null, 'German Language - B2 Group'), 'B2');
  assert.equal(levelOf('Level A1', 'anything'), 'A1');
  assert.equal(levelOf(null, 'Nursing'), null);
});

test("the model's marks are matched by name, clamped to half points within the maximum, and summed here", () => {
  const criteria = criteriaFor(TELC_B1, TELC_B1.blocks.find((b) => b.id === 'sa')!);
  assert.equal(criteria.length, 3);
  const r = parseMarking(
    {
      marks: [
        { criterion: 'Formale Richtigkeit', points: 12.3, comment: 'Gut.' },
        { criterion: 'Inhalt', points: 99, comment: 'Alles da.' },
        { criterion: 'kommunikative gestaltung', points: -2, comment: 'Anrede fehlt.' },
      ],
      overall: 'Weiter so.',
    },
    criteria,
    false,
  );
  assert.deepEqual(r.marks.map((m) => [m.criterion, m.points]), [['Inhalt', 15], ['Kommunikative Gestaltung', 0], ['Formale Richtigkeit', 12.5]]);
  assert.equal(r.points, 27.5);
  assert.equal(r.max, 45);
  assert.equal(r.overall, 'Weiter so.');
});

test('a speaking task with one score is marked on the three telc speaking criteria shared over its points', () => {
  const ma1 = TELC_A1.blocks.find((b) => b.id === 'ma1')!;
  const criteria = criteriaFor(TELC_A1, ma1);
  assert.deepEqual(criteria.map((c) => c.max), [2, 1.5, 1.5]);
  assert.equal(criteria.reduce((a, c) => a + c.max, 0), ma1.points);
});

test('the task text the marker sees is the brief and the lead points, without markup', () => {
  const text = taskTextOf({ brief: 'Schreiben Sie eine <b>E-Mail</b>.', leit: [{ k: 'a', t: 'Grund' }, { k: 'b', t: 'Termin' }] });
  assert.equal(text, 'Schreiben Sie eine E-Mail.\n\na) Grund\nb) Termin');
  const chosen = taskTextOf({ themen: [{ titel: 'Beschwerde', brief: 'x' }, { titel: 'Anfrage', brief: 'y', leit: [] }] }, 1);
  assert.equal(chosen, 'Anfrage\n\ny');
});
