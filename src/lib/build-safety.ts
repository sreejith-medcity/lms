import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The mistakes this project has actually made, turned into checks.
 *
 * Every rule here corresponds to a real failure in this repository, not to a
 * style preference. Two of them broke a deployment; one of them published a
 * list of strings as a callable HTTP endpoint. Each was found by hand, fixed by
 * hand, and then swept for by hand before every commit since, which works right
 * up until the evening somebody forgets.
 *
 * They are checks a type system cannot make. Next's directives are strings, and
 * a string in the wrong place is still valid TypeScript.
 */

export interface Violation {
  rule: string;
  file: string;
  detail: string;
}

const SERVER_ONLY = [
  'lib/db',
  'lib/secrets',
  'lib/integration-store',
  'lib/auth',
  'lib/sign-in',
  'lib/otp',
  'lib/totp',
  'lib/zoom',
  'lib/sso',
  'lib/storage',
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

/** The first thing in the file that is not a comment or blank. */
function firstStatement(source: string): string {
  const lines = source.split('\n');
  let inBlockComment = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    if (line.startsWith('//')) continue;

    return line;
  }
  return '';
}

/**
 * Every permission key the code asks for, checked against the catalogue.
 *
 * `requireStaff` throws FORBIDDEN for a key no role can hold, and a key that is
 * not in `PERMISSION_GROUPS` can never be held by anybody, including a super
 * admin. So a typo here is not a permissions bug that shows up for some users:
 * it is a page that is unreachable by everyone, and it fails at runtime with a
 * server exception rather than at build time.
 *
 * This is not hypothetical. The redirects screen shipped asking for
 * `settings.website`, which does not exist, and nobody could open it.
 */
export function auditPermissionKeys(root: string): Violation[] {
  const catalogue = readFileSync(join(root, 'src', 'lib', 'permissions.ts'), 'utf8');

  const known = new Set<string>();
  for (const [, group, items] of catalogue.matchAll(/^\s{2}(\w+):\s*\[([^\]]*)\]/gm)) {
    for (const [, item] of items.matchAll(/'([\w.]+)'/g)) known.add(`${group}.${item}`);
  }

  if (known.size === 0) {
    return [
      {
        rule: 'permission-key-exists',
        file: 'src/lib/permissions.ts',
        detail: 'No permission keys could be read from the catalogue, so this check is not working.',
      },
    ];
  }

  const violations: Violation[] = [];

  for (const file of walk(join(root, 'src'))) {
    const relative = file.slice(root.length + 1);
    if (relative === 'src/lib/permissions.ts' || relative === 'src/lib/build-safety.ts') continue;

    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(/requireStaff\(\s*'([\w.]+)'/g)) {
      const key = match[1];
      if (!known.has(key)) {
        violations.push({
          rule: 'permission-key-exists',
          file: relative,
          detail: `requireStaff('${key}') asks for a permission that is not in PERMISSION_GROUPS, so nobody can ever hold it and the page throws FORBIDDEN for everyone`,
        });
      }
    }
  }

  return violations;
}

/**
 * Every setting the code reads, checked against the registry.
 *
 * A setting read but never declared is a switch nobody can flip: no screen
 * offers it, so it is stuck on its fallback forever and the feature behind it
 * is unreachable. It shipped that way once already, with the loyalty engine
 * switch, which was written, read on every earn, and absent from the settings
 * screen.
 *
 * The reverse is checked by the settings screen itself, which renders every
 * declared setting and says out loud when nothing reads one.
 */
export function auditSettingKeys(root: string): Violation[] {
  const registry = readFileSync(join(root, 'src', 'lib', 'settings', 'registry.ts'), 'utf8');

  const known = new Set<string>();
  for (const [, key] of registry.matchAll(/^\s*key: '([\w.]+)',$/gm)) known.add(key);

  if (known.size === 0) {
    return [
      {
        rule: 'setting-key-exists',
        file: 'src/lib/settings/registry.ts',
        detail: 'No setting keys could be read from the registry, so this check is not working.',
      },
    ];
  }

  const violations: Violation[] = [];
  const readers = /\b(?:setting|settingBool|settingNumber|settingText)\(\s*[\w.]+\s*,\s*'([\w.]+)'/g;

  for (const file of walk(join(root, 'src'))) {
    const relative = file.slice(root.length + 1);
    if (relative.startsWith('src/lib/settings/')) continue;

    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(readers)) {
      const key = match[1];
      if (!known.has(key)) {
        violations.push({
          rule: 'setting-key-exists',
          file: relative,
          detail: `reads the setting '${key}', which is not declared in the registry, so no screen offers it and it is stuck on its fallback`,
        });
      }
    }
  }

  return violations;
}

export function auditBuildSafety(root: string): Violation[] {
  const violations: Violation[] = [];

  for (const file of walk(join(root, 'src'))) {
    const relative = file.slice(root.length + 1);

    // This file necessarily contains examples of every pattern it looks for,
    // in the comments explaining why each one is a mistake. Checking itself
    // would report those examples as the mistakes they describe.
    if (relative === 'src/lib/build-safety.ts') continue;

    violations.push(...checkSource(relative, readFileSync(file, 'utf8')));
  }

  violations.push(...auditPermissionKeys(root));
  violations.push(...auditSettingKeys(root));

  return violations;
}

/**
 * The rules, applied to one file's text.
 *
 * Split out from the walk so the detector itself can be tested against
 * deliberately broken input. A check that has only ever been run on code that
 * passes is a check nobody has any reason to trust.
 */
export function checkSource(relative: string, source: string): Violation[] {
  const violations: Violation[] = [];

  const hasClient = /^\s*['"]use client['"];?\s*$/m.test(source);
  const hasServer = /^\s*['"]use server['"];?\s*$/m.test(source);

  /**
   * Rule one. A directive that is not the very first statement is ignored by
   * the bundler, and the file is treated as the opposite kind. This took a
   * Hostinger deployment down once: an `import Link` had drifted above
   * `'use client'` in the login form, and the build failed with an error
   * naming neither.
   */
  if (hasClient || hasServer) {
    const first = firstStatement(source);
    const expected = hasClient ? 'use client' : 'use server';
    if (!first.includes(expected)) {
      violations.push({
        rule: 'directive-first',
        file: relative,
        detail: `'${expected}' must be the first statement; the file starts with: ${first.slice(0, 60)}`,
      });
    }
  }

  /**
   * Rule two. Everything exported from a `'use server'` file becomes a
   * callable endpoint, so a non-async export either breaks the build or
   * publishes something that was never meant to leave the server. This
   * happened here: a `STAGES` array of strings was exported from the leads
   * actions and had to be moved out.
   *
   * Types are exempt, because they are erased before any of this matters.
   */
  if (hasServer) {
    for (const match of source.matchAll(/^export\s+(const|let|var|class|function)\s+(\w+)/gm)) {
      const [, kind, name] = match;
      if (kind === 'function' && /^export\s+async\s+function/m.test(match[0])) continue;
      violations.push({
        rule: 'server-exports-async-only',
        file: relative,
        detail: `${kind} ${name} is exported from a 'use server' file; move it to a plain module or make it an async function`,
      });
    }
  }

  /**
   * Rule three.
   *
   * Destructuring a Node builtin out of a dynamic import gives undefined in
   * the production bundle while working perfectly in development. This cost a
   * live feature: `const { Readable } = await import('node:stream')` in the
   * upload path meant every file upload failed once deployed, reporting a
   * chunk that could not be written, with the cause nowhere near the message.
   *
   * Node builtins belong at the top of the file. There is no bundle size
   * argument for deferring them; they are already in the runtime.
   */
  for (const match of source.matchAll(
    /const\s*\{[^}]*\}\s*=\s*await\s+import\(\s*['"]node:([\w/]+)['"]/g,
  )) {
    violations.push({
      rule: 'no-destructured-node-import',
      file: relative,
      detail: `destructures from a dynamic import of node:${match[1]}, which is undefined in the production bundle even though it works in development; import it at the top of the file instead`,
    });
  }

  /**
   * Rule four. A client component that imports a server module drags it into
   * the browser bundle. For most of these that is a build error; for a few it
   * would be worse than an error, because `secrets.ts` holds the code that
   * unseals gateway keys and `integration-store.ts` reads them.
   */
  if (hasClient) {
    for (const module of SERVER_ONLY) {
      const pattern = new RegExp(`from\\s+['"]@/${module}['"]`);
      if (pattern.test(source)) {
        violations.push({
          rule: 'no-server-module-in-client',
          file: relative,
          detail: `imports @/${module}, which belongs on the server only`,
        });
      }
    }
  }

  return violations;
}
