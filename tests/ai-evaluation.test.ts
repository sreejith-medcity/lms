import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAM_PRESETS,
  evaluationSystemPrompt,
  extractJson,
  isPass,
  marksFromScale,
  parseEvaluation,
  parseTask,
  presetFor,
  scoreLabel,
  wordCount,
} from '../src/lib/ai-evaluation';

test('every preset has a scale a pass mark sits inside, and unique criteria', () => {
  for (const p of EXAM_PRESETS) {
    assert.ok(p.pass >= p.scale.min && p.pass <= p.scale.max, p.key);
    assert.equal(new Set(p.criteria.map((c) => c.key)).size, p.criteria.length, p.key);
    assert.match(evaluationSystemPrompt(p), /Return ONLY a JSON object/);
  }
  assert.equal(presetFor('nope'), null);
});

test('an evaluation is clamped and snapped to the exam scale, with every criterion present', () => {
  const ielts = presetFor('IELTS_TASK2')!;
  const reply = `Here you go:\n{"overall": 6.7, "criteria": [{"key":"tr","score":6,"comment":"Clear position."},{"key":"GRA","score":11,"comment":"Many slips."}], "strengths":["Clear"], "improvements":["Use more complex sentences, e.g. ..."], "corrections":[{"original":"peoples","better":"people","why":"uncountable"}], "summary":"Solid 6.5."}`;
  const r = parseEvaluation(reply, ielts);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.evaluation.overall, 6.5);
    assert.equal(r.evaluation.criteria.length, 4);
    assert.equal(r.evaluation.criteria.find((c) => c.key === 'GRA')?.score, 9);
    // A criterion the model skipped falls back to the overall rather than vanishing.
    assert.equal(r.evaluation.criteria.find((c) => c.key === 'CC')?.score, 6.5);
    assert.equal(r.evaluation.corrections[0].better, 'people');
  }
  assert.equal(parseEvaluation('not json', ielts).ok, false);
  assert.equal(parseEvaluation('{"criteria":[]}', ielts).ok, false);
});

test('marks on a question come from the scale, and pass lines hold', () => {
  const ielts = presetFor('IELTS_TASK2')!;
  assert.equal(marksFromScale(ielts, 4.5, 10), 5);
  assert.equal(marksFromScale(ielts, 9, 10), 10);
  assert.equal(isPass(ielts, 7), true);
  assert.equal(isPass(ielts, 6.5), false);
  const oet = presetFor('OET_LETTER')!;
  assert.equal(marksFromScale(oet, 350, 20), 14);
  assert.equal(scoreLabel(ielts, 6.5), 'Band 6.5');
  assert.equal(scoreLabel(ielts, 7), 'Band 7');
  assert.equal(scoreLabel(oet, 350), '350 of 500');
  assert.equal(scoreLabel(presetFor('GERMAN_B1_WRITING')!, 38), '38 of 45 Punkte');
});

test('tasks and json are pulled out of whatever wrapping the model used', () => {
  assert.deepEqual(parseTask('```json\n{"title":"Cities","task":"Some people think..."}\n```'), { title: 'Cities', task: 'Some people think...' });
  assert.equal(parseTask('{"title":"x"}'), null);
  assert.equal(extractJson('{'), null);
  assert.equal(wordCount('  one two\nthree  '), 3);
});
