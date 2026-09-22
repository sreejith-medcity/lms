/**
 * Write prisma/rls.sql and prisma/rls-off.sql from the schema.
 *
 *   npm run rls:sql
 *
 * Run it after any change to prisma/schema.prisma; the test in
 * tests/rls-sql.test.ts fails until the committed files match.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { rlsOffSql, rlsPlan, rlsSql } from '../src/lib/rls-sql';

const plan = rlsPlan(readFileSync('prisma/schema.prisma', 'utf8'));
writeFileSync('prisma/rls.sql', rlsSql(plan));
writeFileSync('prisma/rls-off.sql', rlsOffSql(plan));
console.log(`${plan.direct.length} tables name the academy, ${plan.children.length} belong to one of those, ${plan.open.length} left open.`);
