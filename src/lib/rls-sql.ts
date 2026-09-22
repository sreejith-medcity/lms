/**
 * The row-level security policies, written from the Prisma schema.
 *
 * Every table is one of three things. A table with an `organizationId`
 * column belongs to that academy, and its policy compares the column with
 * the scope (`app.scope`, set per query by `db-rls.ts`). A table without
 * one but with a required relation leading to such a table (a material
 * belongs to a section, which belongs to a module, which names the
 * academy) is a child: its policy asks whether its parent row is visible,
 * and the parent's own policy answers, so the chain is followed one link
 * at a time and never written out. The rest are the platform's (tenants,
 * plans, console users) or shared catalogues (permissions) and are left
 * open: they hold nothing of one academy's.
 *
 * `prisma/rls.sql` is this output, committed, and a test keeps it equal to
 * what the schema says now: a new tenant table cannot arrive without its
 * policy arriving in the same commit. `prisma/rls-off.sql` switches every
 * policy off again in one go, for the day something is wrong.
 */

export interface RlsTable {
  model: string;
  table: string;
}

export interface RlsChild extends RlsTable {
  column: string;
  parent: string;
  parentColumn: string;
  optional: boolean;
  depth: number;
}

export interface RlsPlan {
  direct: RlsTable[];
  children: RlsChild[];
  open: RlsTable[];
}

/**
 * Tables that carry a user's id without a relation in the schema (they
 * are written by the AI tutor, which keys on ids it was handed). The
 * column still points at a user, so the policy follows it.
 */
const IMPLICIT_PARENTS: Record<string, { column: string; parent: string }> = {
  SkillMastery: { column: 'userId', parent: 'User' },
  StudyPlanItem: { column: 'userId', parent: 'User' },
};

interface Relation {
  field: string;
  target: string;
  optional: boolean;
  columns: string[];
  references: string[];
}

interface Model {
  name: string;
  table: string;
  hasOrganization: boolean;
  relations: Relation[];
}

export function parseModels(schema: string): Model[] {
  const models: Model[] = [];
  const pattern = /^model (\w+) \{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(schema))) {
    const [, name, body] = match;
    const map = /@@map\("([^"]+)"\)/.exec(body);
    const relations: Relation[] = [];
    for (const line of body.split('\n')) {
      const rel = /^\s*(\w+)\s+(\w+)(\?|\[\])?\s+.*@relation\(([^)]*)\)/.exec(line);
      if (!rel) continue;
      const [, field, target, suffix, args] = rel;
      const fields = /fields:\s*\[([^\]]+)\]/.exec(args);
      if (!fields) continue;
      const references = /references:\s*\[([^\]]+)\]/.exec(args);
      relations.push({
        field,
        target,
        optional: suffix === '?',
        columns: fields[1].split(',').map((s) => s.trim()),
        references: (references?.[1] ?? 'id').split(',').map((s) => s.trim()),
      });
    }
    const implicit = IMPLICIT_PARENTS[name];
    if (implicit) relations.push({ field: implicit.column, target: implicit.parent, optional: false, columns: [implicit.column], references: ['id'] });
    models.push({
      name,
      table: map ? map[1] : name,
      hasOrganization: /^\s*organizationId\s+String(?!\?)/m.test(body),
      relations,
    });
  }
  return models;
}

export function rlsPlan(schema: string): RlsPlan {
  const models = parseModels(schema);
  const byName = new Map(models.map((m) => [m.name, m]));
  const memo = new Map<string, Relation[] | null>();

  /** The shortest chain of relations from this model to one that names the academy; required links preferred. */
  function chain(name: string, seen: Set<string>): Relation[] | null {
    const model = byName.get(name);
    if (!model) return null;
    if (model.hasOrganization) return [];
    if (memo.has(name)) return memo.get(name)!;
    if (seen.has(name)) return null;
    seen.add(name);
    let best: Relation[] | null = null;
    for (const relation of model.relations) {
      if (relation.references.length !== 1 || relation.columns.length !== 1) continue;
      const rest = chain(relation.target, new Set(seen));
      if (rest === null) continue;
      const candidate = [relation, ...rest];
      const better =
        best === null ||
        (best[0].optional && !relation.optional) ||
        (best[0].optional === relation.optional && candidate.length < best.length);
      if (better) best = candidate;
    }
    // A dead end found while walking a cycle is only a dead end from that
    // direction, so only a found chain is remembered.
    if (best) memo.set(name, best);
    return best;
  }

  const plan: RlsPlan = { direct: [], children: [], open: [] };
  for (const model of models) {
    if (model.hasOrganization) {
      plan.direct.push({ model: model.name, table: model.table });
      continue;
    }
    const path = chain(model.name, new Set());
    if (!path) {
      plan.open.push({ model: model.name, table: model.table });
      continue;
    }
    const [first] = path;
    plan.children.push({
      model: model.name,
      table: model.table,
      column: first.columns[0],
      parent: byName.get(first.target)!.table,
      parentColumn: first.references[0],
      optional: first.optional,
      depth: path.length,
    });
  }
  return plan;
}

const q = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

function policyFor(table: string, predicate: string): string[] {
  return [
    `ALTER TABLE ${q(table)} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${q(table)} FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS lms_tenant ON ${q(table)};`,
    `CREATE POLICY lms_tenant ON ${q(table)} USING (${predicate}) WITH CHECK (${predicate});`,
    '',
  ];
}

export function rlsSql(plan: RlsPlan): string {
  const lines: string[] = [
    '-- Row-level security for the LMS. Written by `npm run rls:sql` from prisma/schema.prisma; do not edit by hand.',
    '--',
    '-- Apply after the app is running with DATABASE_RLS=1 (it sets app.scope on every query),',
    '-- never before: with these policies on and no scope set, every table is empty.',
    '--   npx prisma db execute --file prisma/rls.sql --schema prisma/schema.prisma',
    '-- Undo with prisma/rls-off.sql. Safe to apply again after a schema change.',
    '',
    "CREATE OR REPLACE FUNCTION lms_scope_platform() RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT coalesce(current_setting('app.scope', true), '') = 'platform' $$;",
    "CREATE OR REPLACE FUNCTION lms_scope_org() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT CASE WHEN coalesce(current_setting('app.scope', true), '') LIKE 'tenant:%' THEN substr(current_setting('app.scope', true), 8) END $$;",
    '',
    `-- ${plan.direct.length} tables that name the academy`,
    '',
  ];
  for (const t of plan.direct) {
    lines.push(...policyFor(t.table, `lms_scope_platform() OR "organizationId" = lms_scope_org()`));
  }
  lines.push(`-- ${plan.children.length} tables that belong to a row in one of those`, '');
  for (const c of plan.children) {
    const exists = `EXISTS (SELECT 1 FROM ${q(c.parent)} p WHERE p.${q(c.parentColumn)} = ${q(c.table)}.${q(c.column)})`;
    const own = c.optional ? `${q(c.table)}.${q(c.column)} IS NULL OR ${exists}` : exists;
    lines.push(`-- ${c.table}.${c.column} -> ${c.parent}${c.depth > 1 ? ` (${c.depth} links to the academy)` : ''}`);
    lines.push(...policyFor(c.table, `lms_scope_platform() OR ${own}`));
  }
  lines.push(`-- Left open, nothing of one academy's in them: ${plan.open.map((t) => t.table).join(', ')}`, '');
  return lines.join('\n');
}

export function rlsOffSql(plan: RlsPlan): string {
  const lines = [
    '-- Switches every row-level security policy off. Written by `npm run rls:sql`; do not edit by hand.',
    '--   npx prisma db execute --file prisma/rls-off.sql --schema prisma/schema.prisma',
    '',
  ];
  for (const t of [...plan.direct, ...plan.children]) {
    lines.push(`ALTER TABLE ${q(t.table)} NO FORCE ROW LEVEL SECURITY;`, `ALTER TABLE ${q(t.table)} DISABLE ROW LEVEL SECURITY;`);
  }
  lines.push('');
  return lines.join('\n');
}
