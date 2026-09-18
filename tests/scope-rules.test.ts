import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeStaffWhere, assignmentImpact, assignmentState, contactFromRecord, dayStart } from '../src/lib/scope-rules';
import { parseList, parseProgram } from '../src/lib/programs';
import { STANDARD_ROLES, roleGrants } from '../src/lib/standard-roles';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const today = new Date('2026-09-18T10:30:00Z');

test('an assignment is active between its dates, both inclusive, and open-ended when null', () => {
  assert.equal(assignmentState({ startsOn: null, endsOn: null }, today), 'active');
  assert.equal(assignmentState({ startsOn: day('2026-09-18'), endsOn: null }, today), 'active');
  assert.equal(assignmentState({ startsOn: day('2026-09-19'), endsOn: null }, today), 'upcoming');
  assert.equal(assignmentState({ startsOn: null, endsOn: day('2026-09-18') }, today), 'active');
  assert.equal(assignmentState({ startsOn: null, endsOn: day('2026-09-17') }, today), 'ended');
  assert.equal(assignmentState({ startsOn: day('2026-09-01'), endsOn: day('2026-09-30') }, today), 'active');
});

test('the Prisma fragment says the same thing as the state', () => {
  const where = activeStaffWhere(today);
  assert.deepEqual(where, {
    AND: [
      { OR: [{ startsOn: null }, { startsOn: { lte: dayStart(today) } }] },
      { OR: [{ endsOn: null }, { endsOn: { gte: dayStart(today) } }] },
    ],
  });
  assert.equal(dayStart(today).toISOString(), '2026-09-18T00:00:00.000Z');
});

test('the impact preview tells the Branch Head what access changes, and never mentions fees as included', () => {
  const nameOf = (id: string) => ({ a: 'Anjali', b: 'Biju' })[id] ?? id;
  const current = [{ userId: 'b', role: 'PRIMARY_TUTOR', startsOn: null, endsOn: null }];
  const lines = assignmentImpact({ current, change: { userId: 'a', role: 'PRIMARY_TUTOR', startsOn: null, endsOn: null }, today }, nameOf);
  assert.match(lines[0], /Anjali can see this batch/);
  assert.ok(lines.some((l) => /Biju stays on the batch too; end their assignment/.test(l)));
  assert.match(lines[lines.length - 1], /Fees are never part/);

  const future = assignmentImpact({ current: [], change: { userId: 'a', role: 'PRIMARY_TUTOR', startsOn: day('2026-10-01'), endsOn: null }, today }, nameOf);
  assert.match(future[0], /gets access on 2026-10-01/);

  const ended = assignmentImpact({ current, change: { end: { userId: 'b', role: 'PRIMARY_TUTOR', endsOn: day('2026-09-10') } }, today }, nameOf);
  assert.match(ended[0], /Biju loses access to this batch now; their marks and registers stay/);
  const later = assignmentImpact({ current, change: { end: { userId: 'b', role: 'PRIMARY_TUTOR', endsOn: day('2026-09-30') } }, today }, nameOf);
  assert.match(later[0], /keeps access until 2026-09-30/);
});

test('contacts on the record become the shapes a parent signs in with', () => {
  assert.deepEqual(contactFromRecord(null), []);
  assert.deepEqual(contactFromRecord({ parentPhone: '+91 98470 12345', parentEmail: ' Amma@Example.com ' }), [
    { contact: '9847012345', kind: 'phone' },
    { contact: 'amma@example.com', kind: 'email' },
  ]);
  assert.deepEqual(contactFromRecord({ parentPhone: '12345', parentEmail: 'not-an-email' }), []);
});

test('program lists are ordered, trimmed and de-duplicated', () => {
  assert.deepEqual(parseList('A1, a1 ,A2\nB1,,  B2  '), ['A1', 'A2', 'B1', 'B2']);
  assert.deepEqual(parseList(''), []);
});

test('a program needs a name and at least one kind of test; the pass mark is a percentage', () => {
  const base = { name: 'German', code: 'de', description: '', levels: 'A1, A2', skills: 'Reading, Writing', categories: 'Class Test, Final Examination', passPercent: '60', retestRule: 'BEST' };
  const ok = parseProgram(base);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.code, 'DE');
    assert.equal(ok.value.passPercent, 60);
    assert.equal(ok.value.retestRule, 'BEST');
    assert.deepEqual(ok.value.levels, ['A1', 'A2']);
  }
  assert.equal(parseProgram({ ...base, name: ' ' }).ok, false);
  assert.equal(parseProgram({ ...base, categories: '' }).ok, false);
  assert.equal(parseProgram({ ...base, passPercent: '140' }).ok, false);
  const latest = parseProgram({ ...base, retestRule: 'nonsense', passPercent: '' });
  assert.ok(latest.ok && latest.value.retestRule === 'LATEST' && latest.value.passPercent === null);
});

test('the standard roles keep money away from teachers and give the Academic Manager a view only', () => {
  const teacher = STANDARD_ROLES.find((r) => r.name === 'Teacher')!;
  assert.equal(teacher.restrictBatch, true);
  assert.equal(roleGrants(teacher, 'sales.fee_tracking'), null);
  assert.equal(roleGrants(teacher, 'sales.payments'), null);
  assert.equal(roleGrants(teacher, 'learner.learner_export'), null);
  assert.deepEqual(roleGrants(teacher, 'scheduling.sessions'), { canView: true, canEdit: true, canDelete: false });

  const head = STANDARD_ROLES.find((r) => r.name === 'Branch Head')!;
  assert.equal(head.restrictBranch, true);
  assert.ok(roleGrants(head, 'sales.fee_tracking'));
  assert.equal(roleGrants(head, 'settings.roles'), null);
  assert.equal(roleGrants(head, 'learner.learner_impersonate'), null);

  const manager = STANDARD_ROLES.find((r) => r.name === 'Academic Manager')!;
  assert.deepEqual(roleGrants(manager, 'reports.batch_reports'), { canView: true, canEdit: false, canDelete: false });
  assert.equal(roleGrants(manager, 'reports.sales_reports'), null);
  assert.equal(roleGrants(manager, 'sales.fee_tracking'), null);
});
