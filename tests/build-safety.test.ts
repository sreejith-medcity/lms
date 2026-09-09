import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { auditBuildSafety, checkSource } from '../src/lib/build-safety';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each of these has broken this project once. The check is cheaper than the
 * evening spent reading a build log that names the wrong file.
 */

test('nothing breaks the rules that have broken this build before', () => {
  const violations = auditBuildSafety(root);

  const report = violations
    .map((v) => `  [${v.rule}] ${v.file}\n      ${v.detail}`)
    .join('\n');

  assert.equal(violations.length, 0, `\n${report}\n`);
});

/**
 * The detector, tested against the shapes that actually broke this project.
 * A check that has only ever run on passing code is a check nobody has reason
 * to trust, and the first time it matters is the wrong time to find out it
 * never worked.
 */

const rules = (source: string) => checkSource('x.tsx', source).map((v) => v.rule);

test('catches a directive that has drifted below an import', () => {
  // This is very close to the file that took a Hostinger deploy down: an
  // import had ended up above the directive, and the build error named
  // neither the file nor the cause.
  const bad = ["import Link from 'next/link';", "'use client';", '', 'export function F() {}'].join('\n');
  assert.ok(rules(bad).includes('directive-first'));
});

test('accepts a directive under a licence header or a doc comment', () => {
  const good = ['/**', ' * A form.', ' */', "'use client';", '', 'export function F() {}'].join('\n');
  assert.deepEqual(rules(good), []);

  const alsoGood = ['// a note', "'use client';", 'export function F() {}'].join('\n');
  assert.deepEqual(rules(alsoGood), []);
});

test('catches a non-async export from a server actions file', () => {
  // The real one: a STAGES array exported from the leads actions, which
  // publishes a list of strings as a callable endpoint.
  const bad = ["'use server';", '', "export const STAGES = ['NEW', 'WON'];"].join('\n');
  assert.ok(rules(bad).includes('server-exports-async-only'));
});

test('allows async functions and type-only exports from a server file', () => {
  const good = [
    "'use server';",
    '',
    'export interface State { error?: string }',
    'export type Kind = "a" | "b";',
    'export async function act() { return 1; }',
  ].join('\n');
  assert.deepEqual(rules(good), []);
});

test('catches a client component importing the module that unseals keys', () => {
  const bad = ["'use client';", "import { open } from '@/lib/secrets';", 'export function F() {}'].join('\n');
  assert.ok(rules(bad).includes('no-server-module-in-client'));
});

test('leaves a server component importing the same module alone', () => {
  const good = ["import { open } from '@/lib/secrets';", 'export default function P() {}'].join('\n');
  assert.deepEqual(rules(good), []);
});

test('reports every problem in a file, not just the first', () => {
  const bad = [
    "import { db } from '@/lib/db';",
    "'use client';",
    'export function F() {}',
  ].join('\n');
  const found = rules(bad);
  assert.ok(found.includes('directive-first'));
  assert.ok(found.includes('no-server-module-in-client'));
});
