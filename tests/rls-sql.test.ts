import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseModels, rlsOffSql, rlsPlan, rlsSql } from '../src/lib/rls-sql';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');

/**
 * The policies are only as good as the list of tables they cover, and that
 * list is written by a program from the schema. These tests pin what the
 * program decides about the real schema, so a new table cannot slip
 * through as "open" unnoticed, and keep the committed SQL equal to what
 * the schema says today.
 */

test('the committed policy files match the schema (run npm run rls:sql after a schema change)', () => {
  const plan = rlsPlan(schema);
  assert.equal(readFileSync(resolve(root, 'prisma/rls.sql'), 'utf8'), rlsSql(plan), 'prisma/rls.sql is stale');
  assert.equal(readFileSync(resolve(root, 'prisma/rls-off.sql'), 'utf8'), rlsOffSql(plan), 'prisma/rls-off.sql is stale');
});

test('every table is accounted for, and only the platform and shared catalogues are left open', () => {
  const plan = rlsPlan(schema);
  const models = parseModels(schema);
  assert.equal(plan.direct.length + plan.children.length + plan.open.length, models.length);

  const open = plan.open.map((t) => t.table).sort();
  assert.deepEqual(open, [
    'impersonation_logs',
    'migration_records',
    'organizations',
    'permissions',
    'plan_features',
    'plan_limits',
    'plans',
    'platform_users',
    'provisioning_jobs',
    'scheduled_jobs',
    'session_recurrences',
    'support_tickets',
    'tenant_domains',
    'tenant_entitlements',
    'tenant_invoices',
    'tenant_subscriptions',
    'tenants',
    'usage_records',
  ]);
});

test('a child follows a required parent, and the chain reaches the academy', () => {
  const plan = rlsPlan(schema);
  const child = (table: string) => plan.children.find((c) => c.table === table)!;
  assert.deepEqual(
    { parent: child('materials').parent, column: child('materials').column, depth: child('materials').depth },
    { parent: 'sections', column: 'sectionId', depth: 2 },
  );
  assert.equal(child('answers').parent, 'attempts');
  assert.equal(child('otp_tokens').optional, true, 'a token before sign-up has no user yet');
  assert.equal(child('skill_mastery').parent, 'users', 'a user id without a relation still counts');
  for (const c of plan.children) assert.ok(c.depth >= 1 && c.depth <= 4, `${c.table} is ${c.depth} links away`);
});

test('the SQL names every column it compares in double quotes, so camelCase survives Postgres', () => {
  const sql = rlsSql(rlsPlan(schema));
  assert.match(sql, /"organizationId" = lms_scope_org\(\)/);
  assert.doesNotMatch(sql, /[^"]organizationId[^"]/, 'an unquoted organizationId would be folded to lower case');
  assert.match(sql, /"materials"\."sectionId"/);
  assert.match(sql, /"otp_tokens"\."userId" IS NULL OR EXISTS/);
});

test('the plan is decided from the schema text alone, so a relation written the other way round is still found', () => {
  const plan = rlsPlan(`
model Org {
  id             String @id
  organizationId String
  @@map("orgs")
}
model Parent {
  id             String @id
  organizationId String
  kids           Kid[]
  @@map("parents")
}
model Kid {
  id       String @id
  parentId String
  parent   Parent @relation(fields: [parentId], references: [id])
  toys     Toy[]
  @@map("kids")
}
model Toy {
  id    String  @id
  kidId String?
  kid   Kid?    @relation(fields: [kidId], references: [id])
  @@map("toys")
}
model Loose {
  id    String @id
  label String
  @@map("loose")
}
`);
  assert.deepEqual(plan.direct.map((t) => t.table), ['orgs', 'parents']);
  assert.deepEqual(
    plan.children.map((c) => [c.table, c.parent, c.optional, c.depth]),
    [
      ['kids', 'parents', false, 1],
      ['toys', 'kids', true, 2],
    ],
  );
  assert.deepEqual(plan.open.map((t) => t.table), ['loose']);
});
