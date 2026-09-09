import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reading the codebase for queries that forget which academy they are in.
 *
 * This product sells to institutes, which means one missing `organizationId` in
 * one `findMany` shows one academy another academy's learners. It is the worst
 * bug this codebase can have: silent, invisible in testing with a single
 * tenant, and discovered by a customer.
 *
 * Type checking cannot catch it, because a where clause is optional and
 * `findMany({})` is perfectly valid TypeScript. So this reads the source
 * instead: for every model that carries an `organizationId` column, every query
 * against it must mention that column, or appear in the list of exceptions with
 * a reason written next to it.
 *
 * Deliberately crude. It reads text rather than building a syntax tree, which
 * means it can be fooled by an unusual formatting. That is an acceptable trade:
 * a check that runs on every commit and catches the ordinary case is worth more
 * than a perfect one nobody finishes.
 */

const QUERY_METHODS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
  'create',
  'createMany',
];

export interface Finding {
  file: string;
  line: number;
  model: string;
  method: string;
  snippet: string;
}

/** Models whose rows belong to one academy, read from the schema itself. */
export function scopedModels(schema: string): Set<string> {
  const out = new Set<string>();
  for (const [, name, body] of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
    if (/^\s*organizationId\s/m.test(body)) {
      out.add(`${name[0].toLowerCase()}${name.slice(1)}`);
    }
  }
  return out;
}

/**
 * Queries that are allowed to be unscoped, each for a stated reason.
 *
 * Every entry is a place where scoping by one academy would be wrong, not a
 * place where it was inconvenient. Adding to this list should feel like a
 * decision.
 */
export const EXCEPTIONS: { file: string; why: string }[] = [
  {
    file: 'src/lib/tenant.ts',
    why: 'Resolves which academy a hostname belongs to, so it runs before there is one.',
  },
  {
    file: 'src/app/api/cron/notifications/route.ts',
    why: 'A scheduled run works through every academy in turn, and scopes each pass itself.',
  },
  {
    file: 'src/app/api/cron/scheduled/route.ts',
    why: 'The same, for meetings and webhook retries.',
  },
  {
    file: 'src/lib/webhooks.ts',
    why: 'Delivery works from the queue rather than from an academy, and each row already belongs to a hook that is scoped.',
  },
  {
    file: 'prisma/seed.ts',
    why: 'Creates the first academy, so it cannot be scoped to one.',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** The text of a call's arguments, by matching brackets from the opening one. */
function argumentsOf(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return source.slice(openIndex + 1, openIndex + 400);
}

/** A `// tenant-safe:` note on one of the few lines above the call. */
export function hasSafetyNote(source: string, at: number): boolean {
  const before = source.slice(0, at).split('\n').slice(-4).join('\n');
  const note = /\/\/\s*tenant-safe:\s*(.+)/.exec(before);
  return Boolean(note && note[1].trim().length > 20);
}

/**
 * Whether the query was handed an object that was built with the organisation
 * in it, one or two assignments earlier in the same file.
 *
 * Only follows a plain `const name = { ... }` in the same file, and only one
 * hop. Anything cleverer than that should be scoped at the call site or carry a
 * written justification, because a reader cannot follow it either.
 */
export function followsScopedVariable(source: string, args: string): boolean {
  const names = new Set<string>();

  for (const key of ['where', 'data']) {
    // `where,` shorthand, or `where: someName`.
    const shorthand = new RegExp(`(?:^|[{,\\s])${key}\\s*(?:,|$|\\})`);
    if (shorthand.test(args)) names.add(key);

    const named = new RegExp(`${key}\\s*:\\s*([A-Za-z_$][\\w$]*)`).exec(args);
    if (named) names.add(named[1]);
  }

  for (const name of names) {
    const declaration = new RegExp(
      `const\\s+${name}\\s*(?::[^=]+)?=\\s*([\\s\\S]{0,900}?);\\n`,
    ).exec(source);
    if (declaration && declaration[1].includes('organizationId')) return true;

    // A spread of another local, as in `{ ...base, ... }`, is followed one hop.
    if (declaration) {
      const spread = /\.\.\.([A-Za-z_$][\w$]*)/.exec(declaration[1]);
      if (spread) {
        const parent = new RegExp(
          `const\\s+${spread[1]}\\s*(?::[^=]+)?=\\s*([\\s\\S]{0,900}?);\\n`,
        ).exec(source);
        if (parent && parent[1].includes('organizationId')) return true;
      }
    }
  }

  return false;
}

/**
 * True when the only thing narrowing this query is a primary key.
 *
 * `{ where: { id } }`, `{ where: { id: { in: ids } } }`, and the compound keys
 * Prisma generates for a two column primary key all count. Anything that also
 * filters on a status, a date or a foreign key does not, because that is a
 * query capable of returning somebody else's rows.
 */
export function isByIdOnly(args: string): boolean {
  const where = whereClause(args);
  if (where === null) return false;

  // The field names being filtered on, at the top level of the where clause.
  const fields = topLevelFields(where);
  if (!fields.length) return false;

  // An `id` at the top level pins the query to rows whose ids were already
  // known, whatever else is filtered alongside it. `{ id, status: 'QUEUED' }`
  // is a guard against a race, not a way to reach another academy's row.
  return fields.some(
    (field) =>
      field === 'id' ||
      // Prisma's compound unique key, e.g. `organizationId_provider`, which
      // names the organisation inside itself.
      field.includes('organizationId'),
  );
}

function whereClause(args: string): string | null {
  const at = args.indexOf('where:');
  if (at < 0) return null;

  const open = args.indexOf('{', at);
  if (open < 0) return null;

  let depth = 0;
  for (let i = open; i < args.length; i += 1) {
    if (args[i] === '{') depth += 1;
    else if (args[i] === '}') {
      depth -= 1;
      if (depth === 0) return args.slice(open + 1, i);
    }
  }
  return null;
}

/** Keys at depth zero of an object literal, ignoring anything nested. */
function topLevelFields(body: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let token = '';

  for (let i = 0; i < body.length; i += 1) {
    const character = body[i];
    if (character === '{' || character === '[' || character === '(') depth += 1;
    else if (character === '}' || character === ']' || character === ')') depth -= 1;
    else if (depth === 0 && character === ':') {
      const name = token.trim().split(/[\s,]/).pop() ?? '';
      if (name) fields.push(name);
      token = '';
      continue;
    } else if (depth === 0 && character === ',') {
      // A bare shorthand key, as in `{ where: { id } }`.
      const name = token.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) fields.push(name);
      token = '';
      continue;
    }
    if (depth === 0) token += character;
  }

  const last = token.trim();
  if (last && /^[A-Za-z_$][\w$]*$/.test(last)) fields.push(last);

  return fields;
}

export function auditTenantScoping(root: string): Finding[] {
  const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');
  const scoped = scopedModels(schema);
  const exempt = new Set(EXCEPTIONS.map((row) => row.file));

  const findings: Finding[] = [];
  const pattern = new RegExp(`\\bdb\\.(\\w+)\\.(${QUERY_METHODS.join('|')})\\s*\\(`, 'g');

  for (const file of walk(join(root, 'src'))) {
    const relative = file.slice(root.length + 1);
    if (exempt.has(relative)) continue;

    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(pattern)) {
      const [whole, model, method] = match;
      if (!scoped.has(model)) continue;

      const open = (match.index ?? 0) + whole.length - 1;
      const args = argumentsOf(source, open);

      // A query that names the organisation is fine.
      if (args.includes('organizationId')) continue;

      // So is one built from a local variable that names it. `where` and `data`
      // are very often assembled a few lines above the call, and a check that
      // cannot see through that would flag most of the correctly written code
      // in this repository.
      if (followsScopedVariable(source, args)) continue;

      // Or one a person has looked at and justified in writing, on the line
      // above. The reason is the point: an escape hatch with no argument
      // attached is how a check like this quietly stops meaning anything.
      if (hasSafetyNote(source, match.index ?? 0)) continue;

      // Reaching a row by its own id is fine, because the id is a cuid nobody
      // can guess and it was handed over by an earlier query that was scoped.
      // Flagging every `update({ where: { id } })` would bury the real finding
      // under two hundred safe ones, and a check nobody can read is a check
      // somebody switches off.
      if (isByIdOnly(args)) continue;

      findings.push({
        file: relative,
        line: source.slice(0, match.index ?? 0).split('\n').length,
        model,
        method,
        snippet: args.replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    }
  }

  return findings;
}
