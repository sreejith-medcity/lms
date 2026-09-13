import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anonymisedUser,
  canClose,
  deletionRequestProblem,
  deletionWarnings,
  exportFileName,
  exportRateProblem,
  statusLabel,
} from '../src/lib/data-rights';

test('one open deletion request at a time', () => {
  assert.equal(deletionRequestProblem([]), null);
  assert.equal(deletionRequestProblem([{ kind: 'EXPORT', status: 'OPEN' }]), null);
  assert.equal(deletionRequestProblem([{ kind: 'DELETION', status: 'REFUSED' }]), null);
  assert.match(deletionRequestProblem([{ kind: 'DELETION', status: 'OPEN' }]) ?? '', /already asked/);
});

test('exports are rate limited by the day', () => {
  assert.equal(exportRateProblem(0), null);
  assert.equal(exportRateProblem(4), null);
  assert.match(exportRateProblem(5) ?? '', /tomorrow/);
});

test('the office is warned about what deletion touches, and nothing when it touches nothing', () => {
  assert.deepEqual(deletionWarnings({ activeEnrolments: 0, unpaidInstalments: 0, certificates: 0, paidOrders: 0 }), []);
  const w = deletionWarnings({ activeEnrolments: 1, unpaidInstalments: 2, certificates: 1, paidOrders: 3 });
  assert.equal(w.length, 4);
  assert.match(w[0], /1 live enrolment:/);
  assert.match(w[1], /2 unpaid instalments/);
  assert.match(w[2], /1 certificate issued/);
  assert.match(w[3], /3 paid orders/);
});

test('an anonymised account keeps nothing that names or reaches the person', () => {
  const a = anonymisedUser('cku123456789abcdef');
  assert.equal(a.name, 'Deleted learner abcdef');
  assert.equal(a.email, null);
  assert.equal(a.phone, null);
  assert.equal(a.passwordHash, null);
  assert.equal(a.status, 'ARCHIVED');
  assert.equal(a.emailOptOut, true);
  assert.ok(a.deletedAt instanceof Date);
});

test('only an open request can be closed, and the labels read plainly', () => {
  assert.equal(canClose('OPEN'), true);
  assert.equal(canClose('DONE'), false);
  assert.equal(canClose('CANCELLED'), false);
  assert.equal(statusLabel('OPEN'), 'Waiting');
  assert.equal(statusLabel('CANCELLED'), 'Withdrawn');
});

test('the export file is named for the academy and the day', () => {
  assert.equal(exportFileName('Medcity International Academy', new Date('2026-09-13T10:00:00Z')), 'my-data-medcity-international-academy-2026-09-13.json');
  assert.equal(exportFileName('!!!', new Date('2026-09-13T10:00:00Z')), 'my-data-academy-2026-09-13.json');
});
