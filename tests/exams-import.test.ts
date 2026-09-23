import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkFile, parseBank, parseContentFile, partHash, storableBlocks } from '../src/lib/exams/import';
import { listeningParts } from '../src/lib/exams/listening';
import { examFormat } from '../src/lib/exams/registry';
import { endOfDayIn, phoneVariants } from '../src/lib/exams/perms';

/* The scrambled telc export: the real shape, hashed text, random keys. */
const FILE = JSON.parse(readFileSync(new URL('./fixtures/exams/telc-sets-scrambled.json', import.meta.url), 'utf8')) as Record<string, { name: string; blocks: Record<string, unknown> }[]>;

test('the telc export is read by level, every set, in file order', () => {
  const { formats, ignored } = parseContentFile(FILE);
  assert.deepEqual(ignored, []);
  assert.deepEqual(formats.map((f) => f.formatCode), ['TELC_A1', 'TELC_A2', 'TELC_B1', 'TELC_B2']);
  for (const f of formats) assert.deepEqual(f.sets.map((s) => s.name), FILE[f.formatCode.slice(5)].map((s) => s.name));
  assert.equal(formats.reduce((a, f) => a + f.sets.length, 0), 50);
});

test('the check finds every block known and keyed in the scrambled export', () => {
  const check = checkFile(FILE);
  assert.deepEqual(check.problems, []);
  for (const f of check.formats) for (const s of f.sets) {
    assert.deepEqual(s.unknown, [], `${f.formatCode} ${s.name}`);
    assert.deepEqual(s.withoutKeys, [], `${f.formatCode} ${s.name}`);
  }
});

test('the other two shapes, and what is left out', () => {
  const set = { name: 'Z', title: '', blocks: { lv1: { items: [{ key: 'a' }, { key: '' }] }, nope: {} } };
  const a = parseContentFile({ TELC_B1: [set], IELTS_X: [set], B1: [set] });
  assert.equal(a.formats.length, 1);
  assert.equal(a.formats[0].sets.length, 2);
  assert.deepEqual(a.ignored, ['IELTS_X']);
  const b = parseContentFile([{ formatCode: 'telc_b1', sets: [set] }]);
  assert.equal(b.formats[0].formatCode, 'TELC_B1');
  const check = checkFile({ TELC_B1: [set, set] });
  assert.equal(check.problems.length, 1);
  assert.deepEqual(check.formats[0].sets[0].unknown, ['nope']);
  assert.deepEqual(check.formats[0].sets[0].withoutKeys, ['lv1']);
  assert.deepEqual(storableBlocks(examFormat('TELC_B1')!, set).map(([id]) => id), ['lv1']);
  assert.equal(checkFile({ hello: [] }).problems.length, 1);
});

test('the telc site bank is read line by line, a broken line skipped', () => {
  const text = [
    'registerLevel("B1",[],[]);',
    `registerSet("B1","A",${JSON.stringify({ hv1: { script: [{ sp: 'Ansage', t: 'x' }], audio: ['/api/audio/1'] } })});`,
    'registerSet("B1","B",{broken);',
    `registerSet("B1","C",${JSON.stringify({})});`,
  ].join('\n');
  const bank = parseBank(text);
  assert.deepEqual([...bank.keys()], ['A', 'C']);
  assert.deepEqual((bank.get('A')!.hv1 as { audio: string[] }).audio, ['/api/audio/1']);
});

test('a recording belongs to its wording: the fingerprint changes with a word', () => {
  const script = [
    { sp: 'Ansage', t: 'Teil eins.' },
    { sp: 'Mann', t: 'Hallo.' },
    { sp: 'Ansage', t: 'Nummer zwei.' },
    { sp: 'Frau', t: 'Guten Tag.' },
  ];
  const a = listeningParts(script, 2).map(partHash);
  const b = listeningParts(script.map((l, i) => (i === 3 ? { ...l, t: 'Guten Abend.' } : l)), 2).map(partHash);
  assert.equal(a.length, 3);
  assert.equal(a[0], b[0]);
  assert.equal(a[1], b[1]);
  assert.notEqual(a[2], b[2]);
});

test('a due date is the end of that day where the academy is', () => {
  assert.equal(endOfDayIn('2026-10-01', 'Asia/Kolkata')?.toISOString(), '2026-10-01T18:29:00.000Z');
  assert.equal(endOfDayIn('2026-10-01', 'UTC')?.toISOString(), '2026-10-01T23:59:00.000Z');
  assert.equal(endOfDayIn('01/10/2026', 'UTC'), null);
});

test('a pasted phone number matches however it was stored', () => {
  const v = phoneVariants('98765 43210');
  for (const x of ['9876543210', '+919876543210', '919876543210']) assert.ok(v.includes(x), x);
  assert.ok(phoneVariants('+91-98765-43210').includes('9876543210'));
  assert.deepEqual(phoneVariants('abc'), []);
});
