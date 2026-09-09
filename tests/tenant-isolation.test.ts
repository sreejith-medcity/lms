import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  auditTenantScoping,
  EXCEPTIONS,
  isByIdOnly,
  hasSafetyNote,
  followsScopedVariable,
} from '../src/lib/tenant-audit';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The worst bug this codebase can have is one academy seeing another's
 * learners, and it is invisible while there is only one academy in the
 * database. So it is checked here rather than hoped for.
 */

test('every query on a tenant-owned table names the academy', () => {
  const findings = auditTenantScoping(root);

  const report = findings
    .map((f) => `  ${f.file}:${f.line}  db.${f.model}.${f.method}(${f.snippet})`)
    .join('\n');

  assert.equal(
    findings.length,
    0,
    `${findings.length} queries on tenant-owned tables do not mention organizationId:\n${report}\n\n` +
      'Scope them, or add the file to EXCEPTIONS in src/lib/tenant-audit.ts with a reason.',
  );
});

test('every exception carries a reason, so the list cannot quietly grow', () => {
  for (const row of EXCEPTIONS) {
    assert.ok(row.why.length > 30, `${row.file} needs a real reason, not a placeholder`);
  }
});

/**
 * The detector itself, against known input. The audit currently reports
 * nothing, which is either because the codebase is clean or because the check
 * is broken, and those look identical from the outside.
 */

test('a query pinned to a primary key is recognised as safe', () => {
  assert.equal(isByIdOnly('{ where: { id } }'), true);
  assert.equal(isByIdOnly('{ where: { id: row.id } }'), true);
  assert.equal(isByIdOnly('{ where: { id: { in: ids } } }'), true);
  // An id plus a guard against a race is still pinned to that one row.
  assert.equal(isByIdOnly("{ where: { id: row.id, status: 'QUEUED' } }"), true);
});

test('a query filtered on something other than an id is not', () => {
  assert.equal(isByIdOnly("{ where: { status: 'ENROLLED' } }"), false);
  assert.equal(isByIdOnly('{ where: { batchId: { in: batchIds } } }'), false);
  assert.equal(isByIdOnly('{ where: { deletedAt: null } }'), false);
  assert.equal(isByIdOnly('{ data: { name } }'), false);
});

test('a compound key naming the organisation counts as scoped', () => {
  assert.equal(isByIdOnly('{ where: { organizationId_provider: { organizationId, provider } } }'), true);
});

test('a where built from a local that names the organisation is followed', () => {
  const source = [
    'const where = {',
    '  organizationId: tenant.organizationId,',
    '  stage,',
    '};',
    '',
  ].join('\n');
  assert.equal(followsScopedVariable(source, '{ where, take: 100 }'), true);
});

test('a where built from a local that does not name it is still reported', () => {
  const source = ["const where = {", "  stage,", "};", ''].join('\n');
  assert.equal(followsScopedVariable(source, '{ where, take: 100 }'), false);
});

test('a safety note counts only when it carries a real reason', () => {
  const real = '  // tenant-safe: the ids come from a query already scoped here\n  await db.x.findMany(';
  assert.equal(hasSafetyNote(real, real.length), true);

  const empty = '  // tenant-safe:\n  await db.x.findMany(';
  assert.equal(hasSafetyNote(empty, empty.length), false);
});
