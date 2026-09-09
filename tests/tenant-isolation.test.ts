import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { auditTenantScoping, EXCEPTIONS } from '../src/lib/tenant-audit';

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
