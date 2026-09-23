import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawPaper, modelAnswers, withoutKeys, type ContentSet } from '../src/lib/exams/draw';
import { markPaper, resultOf, modulePoints, normaliseTyped } from '../src/lib/exams/score';
import { examFormat, EXAM_FORMATS } from '../src/lib/exams/registry';
import { TELC_B1 } from '../src/lib/exams/formats/telc';

/**
 * The draw must give the same paper for the same code as the telc
 * simulator's generator did: every code a tutor has handed a class keeps
 * meaning the same paper after the move. The fixtures were drawn with
 * telc's own generator (exam-src/21-paper.js) for five codes per level,
 * over the real sets' structure (fifty sets, every block and item) with
 * every text replaced by a one-way hash and every answer by a random
 * valid letter: this repository is public, and the real papers and keys
 * must not be in it.
 */
const SETS = JSON.parse(readFileSync(new URL('./fixtures/exams/telc-sets-scrambled.json', import.meta.url), 'utf8')) as Record<string, ContentSet[]>;
const FIX = JSON.parse(readFileSync(new URL('./fixtures/exams/draw-fixtures-scrambled.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown>>;

type Item = { n: number; no: number; key?: string; opts?: { k: string; t?: string; h?: string }[] };
type Block = {
  id: string;
  setName: string;
  items?: Item[];
  bank?: { k: string; t: string }[];
  ads?: { k: string; h: string }[];
  texts?: { tag: string; body: string }[];
  themen?: { titel: string; art?: string }[];
  letter?: { lines: string[] };
  notiz?: { lines: string[] };
  formular?: { rows: unknown[] };
};

function summarise(paper: Block[]) {
  return paper.map((p) => ({
    id: p.id,
    set: p.setName,
    items: (p.items ?? []).map((it) => [it.n, it.no, it.key ?? null]),
    bank: p.bank ? p.bank.map((b) => `${b.k}:${b.t ?? ''}`) : undefined,
    ads: p.ads ? p.ads.map((b) => `${b.k}:${b.h ?? ''}`) : undefined,
    texts: p.texts ? p.texts.map((t) => `${t.tag}:${t.body ?? ''}`) : undefined,
    themen: p.themen ? p.themen.map((t) => `${t.titel}:${t.art ?? ''}`) : undefined,
    opts: (p.items ?? []).map((it) => (it.opts ? it.opts.map((o) => `${o.k}:${o.t ?? o.h ?? ''}`).join('|') : null)),
    letter: p.letter ? p.letter.lines.join(' ') : undefined,
    notiz: p.notiz ? p.notiz.lines.join(' ') : undefined,
    formular: p.formular ? JSON.stringify(p.formular.rows) : undefined,
  }));
}

for (const level of ['A1', 'A2', 'B1', 'B2']) {
  const format = examFormat(`TELC_${level}`)!;
  for (const code of ['ABC123', 'ZZ99ZZ', 'K7M2P4', 'TEST01', 'Q2W3E4']) {
    test(`telc ${level}, code ${code}: the same paper as the simulator drew`, () => {
      const paper = drawPaper(format, SETS[level], code) as unknown as Block[];
      assert.deepEqual(JSON.parse(JSON.stringify(summarise(paper))), FIX[level][code]);
    });
    test(`telc ${level}, code ${code}: counted the same as the simulator`, () => {
      const paper = drawPaper(format, SETS[level], code);
      const perfect: Record<string, string> = {};
      const wrong: Record<string, string> = {};
      for (const p of paper) for (const it of p.items ?? []) {
        perfect[String(it.n)] = it.key!;
        wrong[String(it.n)] = it.key === 'a' ? 'b' : 'a';
      }
      for (const [name, answers] of [['perfect', perfect], ['wrong', wrong]] as const) {
        const m = markPaper(paper, answers);
        const expected = FIX[level][`${code}:${name}`] as { mod: Record<string, { punkte: number; richtig: number; aufgaben: number }>; richtig: number; aufgaben: number };
        assert.equal(m.correct, expected.richtig);
        assert.equal(m.items, expected.aufgaben);
        for (const [id, mod] of Object.entries(expected.mod)) {
          assert.equal(m.modules[id].points, mod.punkte, `${name} ${id} points`);
          assert.equal(m.modules[id].correct, mod.richtig);
          assert.equal(m.modules[id].items, mod.aufgaben);
        }
      }
    });
  }
}

test('every telc format is whole: each block sits in one of its sections and adds up to the module maxima', () => {
  for (const f of EXAM_FORMATS) {
    const sectionIds = new Set(f.sections.map((s) => s.id));
    for (const b of f.blocks) assert.ok(sectionIds.has(b.sectionId), `${f.code} ${b.id} names section ${b.sectionId}`);
    for (const m of f.scoring.modules) {
      const blocks = f.blocks.filter((b) => b.moduleId === m.id);
      const sum = blocks.reduce((a, b) => a + (b.count ? b.points * b.count : b.points), 0);
      assert.equal(Math.round(sum * 100) / 100, m.max, `${f.code} module ${m.id} adds up to ${sum}, not ${m.max}`);
    }
    const total = f.scoring.modules.reduce((a, m) => a + m.max, 0);
    assert.equal(total, f.scoring.total, `${f.code} total`);
  }
});

test('the browser copy of a paper carries no keys, reasons or model answers, and the model answers come back separately', () => {
  const paper = drawPaper(TELC_B1, SETS.B1, 'ABC123');
  const bare = withoutKeys(paper) as unknown as Block[];
  for (const p of bare) for (const it of p.items ?? []) {
    assert.equal(it.key, undefined);
    assert.equal((it as { why?: string }).why, undefined);
  }
  assert.equal(bare.find((p) => p.id === 'sa')!.hasOwnProperty('muster'), false);
  const answers = modelAnswers(paper);
  assert.ok(answers.sa, 'the B1 letter has a model answer');
});

test('the B2 letter always offers one complaint and one other kind, in either order', () => {
  const format = examFormat('TELC_B2')!;
  for (const code of ['ABC123', 'ZZ99ZZ', 'K7M2P4', 'TEST01', 'Q2W3E4', 'AAAAAA', 'BBBBBB']) {
    const sa = drawPaper(format, SETS.B2, code).find((p) => p.id === 'sa') as unknown as Block;
    const kinds = (sa.themen ?? []).map((t) => t.art);
    assert.equal(kinds.length, 2);
    assert.ok(kinds.includes('beschwerde'), `${code}: ${kinds.join(',')}`);
    assert.ok(kinds.some((k) => k !== 'beschwerde'));
  }
});

test('a B1 result needs 180 of 300 and both conditions; a total alone is not enough', () => {
  const pass = resultOf(TELC_B1, { lv: 60, sb: 20, hv: 60, sa: 30, ma: 45 });
  assert.equal(pass?.total, 215);
  assert.equal(pass?.passed, true);
  const spokenShort = resultOf(TELC_B1, { lv: 75, sb: 30, hv: 75, sa: 45, ma: 40 });
  assert.equal(spokenShort?.total, 265);
  assert.equal(spokenShort?.passed, false);
  assert.equal(spokenShort?.conditions.find((c) => c.name.startsWith('Mündliche'))?.met, false);
  const writtenShort = resultOf(TELC_B1, { lv: 30, sb: 10, hv: 30, sa: 45, ma: 75 });
  assert.equal(writtenShort?.total, 190);
  assert.equal(writtenShort?.passed, false);
  assert.equal(resultOf(TELC_B1, { lv: 60, sb: 20, hv: 60, sa: null, ma: 45 }), null, 'no result while a module is unmarked');
});

test('an A1 result is 36 of 60 with no conditions, and the writing module adds the counted form to the marked message', () => {
  const format = examFormat('TELC_A1')!;
  const paper = drawPaper(format, SETS.A1, 'ABC123');
  const answers: Record<string, string> = {};
  for (const p of paper) for (const it of p.items ?? []) answers[String(it.n)] = it.key!;
  const marking = markPaper(paper, answers);
  const noMessage = modulePoints(format, marking, []);
  assert.equal(noMessage.hv, 15);
  assert.equal(noMessage.lv, 15);
  assert.equal(noMessage.sa, null, 'the message is not marked yet');
  const points = modulePoints(format, marking, [{ blockId: 'sa2', points: 7 }, { blockId: 'ma1', points: 5 }, { blockId: 'ma2', points: 4 }, { blockId: 'ma3', points: 3 }]);
  assert.equal(points.sa, 12, 'five for the form and seven for the message');
  assert.equal(points.ma, 12);
  const r = resultOf(format, points);
  assert.equal(r?.total, 54);
  assert.equal(r?.passed, true);
  assert.equal(r?.conditions.length, 0);
});

test('typed answers forgive case, punctuation and spacing but not a different word', () => {
  assert.equal(normaliseTyped('  Frau  Müller. '), 'frau müller');
  assert.equal(normaliseTyped('„Bahnhof“'), 'bahnhof');
  assert.notEqual(normaliseTyped('Montag'), normaliseTyped('Dienstag'));
});
