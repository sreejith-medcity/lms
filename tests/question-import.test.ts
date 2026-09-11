import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportRow, parseQuestionCsv, parseQuestionText, parseQuestions } from '../src/lib/question-import';

test('a numbered list with lettered options and an Answer line', () => {
  const out = parseQuestionText(`
1. Which vitamin is fat soluble?
a) Vitamin C
b) Vitamin D
c) Vitamin B12
Answer: B
Explanation: D, A, E and K are the fat soluble ones.
Tags: Nutrition, biochemistry

2. The heart has four chambers.
Answer: True

3) Name the largest bone in the body.
Marks: 2
`);
  assert.deepEqual(out.problems, []);
  assert.equal(out.questions.length, 3);

  const [q1, q2, q3] = out.questions;
  assert.equal(q1.type, 'MCQ_SINGLE');
  assert.equal(q1.prompt, 'Which vitamin is fat soluble?');
  assert.deepEqual(q1.options.map((o) => o.isCorrect), [false, true, false]);
  assert.equal(q1.explanation, 'D, A, E and K are the fat soluble ones.');
  assert.deepEqual(q1.tags, ['nutrition', 'biochemistry']);

  assert.equal(q2.type, 'TRUE_FALSE');
  assert.deepEqual(q2.options, [
    { label: 'True', isCorrect: true },
    { label: 'False', isCorrect: false },
  ]);

  assert.equal(q3.type, 'SHORT_ANSWER');
  assert.equal(q3.marks, 2);
  assert.equal(q3.options.length, 0);
});

test('a star marks the answer, and two stars make it multi', () => {
  const out = parseQuestionText(`1. Pick the prime numbers.
a) 4
*b) 5
*c) 7
d) 9`);
  assert.equal(out.questions[0].type, 'MCQ_MULTI');
  assert.deepEqual(out.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label), ['5', '7']);
});

test('wrapped prompts, wrapped options and wrapped explanations are joined', () => {
  const out = parseQuestionText(`1. A patient presents with
chest pain radiating to the left arm.
What is the first drug?
A. Aspirin
300 mg
B. Paracetamol
Answer: A
Explanation: Aspirin is
given first.`);
  const q = out.questions[0];
  assert.equal(q.prompt, 'A patient presents with\nchest pain radiating to the left arm.\nWhat is the first drug?');
  assert.equal(q.options[0].label, 'Aspirin 300 mg');
  assert.equal(q.explanation, 'Aspirin is\ngiven first.');
});

test('problems name the line and the question survives elsewhere', () => {
  const out = parseQuestionText(`stray line
1. Fine question?
a) yes
b) no
Answer: A
2. No answer given?
a) yes
b) no
3. Out of order options
a) one
c) three
Answer: a`);
  assert.deepEqual(
    out.problems.map((p) => [p.line, p.message.slice(0, 20)]),
    [
      [1, 'This line is outside'],
      [6, 'No answer was given,'],
      [11, 'Option C is out of o'],
    ],
  );
  assert.equal(out.questions.length, 2);
});

test('a CSV with option columns and an answer letter', () => {
  const out = parseQuestionCsv(`question,option_a,option_b,option_c,answer,explanation,difficulty,marks,negative,tags
"What is 2+2?",3,4,5,B,Basic sum,easy,1,0.25,"maths, arithmetic"
"Select even numbers",2,3,4,"A,C",,hard,2,,maths
"The sky is blue",True,False,,a,,,,,
"Describe photosynthesis",,,,,,medium,5,,biology`);
  assert.deepEqual(out.problems, []);
  assert.equal(out.questions.length, 4);
  assert.equal(out.questions[0].type, 'MCQ_SINGLE');
  assert.equal(out.questions[0].negativeMarks, 0.25);
  assert.equal(out.questions[1].type, 'MCQ_MULTI');
  assert.equal(out.questions[2].type, 'TRUE_FALSE');
  assert.equal(out.questions[2].options[0].isCorrect, true);
  assert.equal(out.questions[3].type, 'SHORT_ANSWER');
  assert.equal(out.questions[3].marks, 5);
  assert.equal(out.questions[3].negativeMarks, 0);
});

test('CSV headers are forgiving and the answer may be the option text', () => {
  const out = parseQuestionCsv(`Prompt,A,B,Correct,Topic
"Capital of France?",Rome,Paris,Paris,geography`);
  assert.deepEqual(out.problems, []);
  assert.equal(out.questions[0].options[1].isCorrect, true);
  assert.deepEqual(out.questions[0].tags, ['geography']);
});

test('a CSV without a question column is refused, and bad rows are named', () => {
  assert.equal(parseQuestionCsv('a,b,c\n1,2,3').problems[0].message, 'The header row needs a "question" column.');
  const out = parseQuestionCsv(`question,option_a,option_b,answer,difficulty
"Ok?",yes,no,A,easy
"Bad difficulty?",yes,no,A,impossible
"Bad answer?",yes,no,Z,easy`);
  assert.equal(out.questions.length, 1);
  assert.deepEqual(out.problems.map((p) => p.line), [3, 4]);
});

test('the format is detected from the first line', () => {
  assert.equal(parseQuestions('question,answer\n"x?",A').format, 'CSV');
  assert.equal(parseQuestions('1. x?\na) y\nb) z\nAnswer: a').format, 'TEXT');
});

test('an exported row imports back to the same question', () => {
  const row = exportRow({
    promptHtml: 'Which are mammals?',
    type: 'MCQ_MULTI',
    options: [
      { label: 'Whale', isCorrect: true },
      { label: 'Shark', isCorrect: false },
      { label: 'Bat', isCorrect: true },
    ],
    explanation: null,
    difficulty: 'HARD',
    marks: 2,
    negativeMarks: 0.5,
    tags: ['biology', 'zoology'],
  });
  const csv = [
    'question,type,option_a,option_b,option_c,option_d,option_e,option_f,answer,explanation,difficulty,marks,negative,tags',
    row.map((c) => `"${c.replace(/"/g, '""')}"`).join(','),
  ].join('\n');
  const back = parseQuestionCsv(csv).questions[0];
  assert.equal(back.type, 'MCQ_MULTI');
  assert.deepEqual(back.options.map((o) => o.isCorrect), [true, false, true]);
  assert.equal(back.difficulty, 'HARD');
  assert.equal(back.negativeMarks, 0.5);
  assert.deepEqual(back.tags, ['biology', 'zoology']);
});
