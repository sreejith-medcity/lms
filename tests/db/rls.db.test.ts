import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TEST_URL, makeAcademy } from './fixture';

/**
 * The policies on the real schema, in a real Postgres: two academies, and
 * a query scoped to one of them that forgets to say so still sees only
 * its own rows, through the direct tables, the child tables and raw SQL,
 * inside and outside a transaction. Applies prisma/rls.sql to the test
 * database on the way in and prisma/rls-off.sql on the way out, so the
 * other database tests are not run under it.
 */
const skip = TEST_URL ? false : 'TEST_DATABASE_URL is not set, so the database-backed tests are skipped.';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function runSqlFile(file: string) {
  const { db } = await import('../../src/lib/db');
  const sql = readFileSync(resolve(root, file), 'utf8');
  for (const statement of sql.split(/;\s*\n/)) {
    const text = statement.replace(/^\s*--.*$/gm, '').trim();
    if (text) await db.$executeRawUnsafe(text);
  }
}

test('with the policies on, an academy sees only its own rows whatever the query forgot', { skip }, async () => {
  const { db } = await import('../../src/lib/db');
  const { runAsOrganization, runAsPlatform } = await import('../../src/lib/db-scope');
  const a = await makeAcademy();
  const b = await makeAcademy();
  const wasOn = process.env.DATABASE_RLS;
  try {
    await runSqlFile('prisma/rls.sql');
    process.env.DATABASE_RLS = '1';

    // Unscoped queries, on purpose: the kind the audit would refuse.
    const seenByA = await runAsOrganization(a.organizationId, async () => ({
      learners: (await db.user.findMany({ where: { kind: 'LEARNER' }, select: { id: true } })).map((u) => u.id),
      plans: await db.pricingPlan.count(),
      other: await db.user.findUnique({ where: { id: b.learnerId }, select: { id: true } }),
      raw: (await db.$queryRaw<{ id: string }[]>`SELECT id FROM products`).map((r) => r.id),
      inTx: await db.$transaction(async (tx) => tx.product.count()),
      batch: await db.$transaction([db.branch.count(), db.course.count()]),
    }));
    assert.deepEqual(seenByA.learners, [a.learnerId]);
    assert.equal(seenByA.plans, 1, 'a child table (pricing plans belong to a product) is scoped through its parent');
    assert.equal(seenByA.other, null, "the other academy's learner is invisible even by id");
    assert.deepEqual(seenByA.raw, [a.productId]);
    assert.equal(seenByA.inTx, 1);
    assert.deepEqual(seenByA.batch, [1, 1]);

    // A write across the line is refused rather than written.
    await assert.rejects(
      runAsOrganization(a.organizationId, () => db.branch.create({ data: { organizationId: b.organizationId, name: 'Sneak', code: 'SNEAK' } })),
      /row-level security/,
    );
    // Updates aimed at the other academy find nothing to change.
    const touched = await runAsOrganization(a.organizationId, () => db.user.updateMany({ where: { id: b.learnerId }, data: { name: 'X' } }));
    assert.equal(touched.count, 0);

    // The platform sees both; nobody sees anything.
    assert.equal(await runAsPlatform(() => db.user.count({ where: { id: { in: [a.learnerId, b.learnerId] } } })), 2);
  } finally {
    if (wasOn === undefined) delete process.env.DATABASE_RLS;
    else process.env.DATABASE_RLS = wasOn;
    await runSqlFile('prisma/rls-off.sql');
    await a.drop();
    await b.drop();
  }
});
