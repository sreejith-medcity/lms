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

export function auditBuildSafety(root: string): Violation[] {
  const violations: Violation[] = [];

  for (const file of walk(join(root, 'src'))) {
    violations.push(...checkSource(file.slice(root.length + 1), readFileSync(file, 'utf8')));
  }

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
   * Rule three. A client component that imports a server module drags it into
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
