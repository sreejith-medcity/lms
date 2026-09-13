import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, parseCitations, parseQuiz, parseSummary, renderContext, transcriptForPrompt, tutorSystemPrompt } from '../src/lib/tutor';

const lesson = {
  materialId: 'm1',
  title: 'Lesson 4: Perfekt',
  body: '',
  segments: [
    { start: 0, end: 3, text: 'Heute sprechen wir über das Perfekt.' },
    { start: 3, end: 6, text: 'Das Perfekt bildet man mit haben oder sein.' },
    { start: 60, end: 65, text: 'Ich habe mich gefreut.' },
  ],
};
const other = {
  materialId: 'm2',
  title: 'Lesson 7: Präteritum',
  body: 'The Präteritum is the written past. War, hatte, wurde.',
  segments: [{ start: 10, end: 14, text: 'Das Präteritum ist die Vergangenheit im Schreiben, nicht das Perfekt.' }],
};

test('the context is this lesson first, then passages elsewhere that mention the question', () => {
  const blocks = buildContext('Wann benutzt man das Perfekt?', lesson, [other]);
  assert.equal(blocks[0].materialId, 'm1');
  assert.ok(blocks.some((b) => b.materialId === 'm2' && b.start === 10));
  const text = renderContext(blocks);
  assert.match(text, /\[Lesson 4: Perfekt @ 0:00\]/);
  assert.match(text, /\[Lesson 7: Präteritum @ 0:10\]/);
});

test('the context stays inside its budget', () => {
  const big = { ...lesson, segments: Array.from({ length: 400 }, (_, i) => ({ start: i * 10, end: i * 10 + 9, text: `Satz nummer ${i} mit einigen Wörtern darin.` })) };
  const blocks = buildContext('Satz', big, [], 2000);
  assert.ok(blocks.reduce((n, b) => n + b.text.length, 0) <= 2000);
  assert.ok(blocks.length > 0);
});

test('the system prompt grounds the tutor and names the lesson', () => {
  const p = tutorSystemPrompt({ academy: 'Medcity', course: 'German B1', lessonTitle: 'Lesson 4' });
  assert.match(p, /Answer only from the course material/);
  assert.match(p, /"Lesson 4"/);
  assert.match(p, /Q&A tab/);
});

test('citations in the asked-for form are read back, once each', () => {
  const c = parseCitations('The Perfekt uses haben or sein (Lesson 4: Perfekt @ 0:03). Also (Lesson 7: Präteritum) and again (Lesson 4: Perfekt @ 0:03).');
  assert.deepEqual(c, [
    { title: 'Lesson 4: Perfekt', seconds: 3 },
    { title: 'Lesson 7: Präteritum', seconds: null },
  ]);
  assert.deepEqual(parseCitations('No citations here.'), []);
});

test('a summary reply is parsed and its chapters kept in order and in range', () => {
  const raw = 'Here: {"summary":"The lesson teaches the Perfekt.","chapters":[{"title":"Ich habe mich gefreut","start":60},{"title":"Intro","start":0},{"title":"Beyond","start":9999}],"keyTerms":["Perfekt","haben","sein"]}';
  const s = parseSummary(raw, 120);
  assert.ok(s);
  assert.equal(s.summary, 'The lesson teaches the Perfekt.');
  assert.deepEqual(s.chapters.map((c) => c.start), [0, 60]);
  assert.deepEqual(s.keyTerms, ['Perfekt', 'haben', 'sein']);
  assert.equal(parseSummary('not json', null), null);
});

test('the transcript for the prompt is timestamped lines within a budget', () => {
  const t = transcriptForPrompt(lesson.segments);
  assert.match(t, /^\[0\] Heute sprechen wir über das Perfekt\. Das Perfekt bildet man mit haben oder sein\.\n\[60\] Ich habe mich gefreut\./);
  assert.ok(transcriptForPrompt(lesson.segments, 10).length <= 10);
});

test('quiz questions are kept only when well formed', () => {
  const raw = '{"questions":[{"prompt":"Perfekt uses?","options":["haben or sein","werden","sollen","dürfen"],"answer":0,"explanation":"Said at 0:03.","difficulty":"EASY"},{"prompt":"bad","options":["one"],"answer":0},{"prompt":"bad index","options":["a","b"],"answer":5},{"prompt":"ok","options":["a","b","c"],"answer":2,"difficulty":"weird"}]}';
  const q = parseQuiz(raw);
  assert.equal(q.length, 2);
  assert.equal(q[0].difficulty, 'EASY');
  assert.equal(q[1].difficulty, 'MEDIUM');
  assert.equal(q[1].explanation, '');
  assert.deepEqual(parseQuiz('nothing'), []);
});
