import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchState, epochDate, learnerRow, normalisePhone, packagePaise, questionRows } from '../src/lib/edmingle-records';

test('phones are kept the way the LMS keeps them', () => {
  assert.equal(normalisePhone('9876543210', '+91'), '9876543210');
  assert.equal(normalisePhone('+91 98765 43210', '+91'), '9876543210');
  assert.equal(normalisePhone('12345', '+91'), null);
  assert.equal(normalisePhone('1234567890', '+91'), null);
  assert.equal(normalisePhone('2025550123', '+1'), '+12025550123');
  assert.equal(normalisePhone('', null), null);
});

test('a learner row keeps what the LMS needs and nothing sensitive', () => {
  const row = learnerRow({
    user_id: 7, name: '  Anjali  R ', email: 'Anjali@Example.com', contact_number: '9876543210', contact_number_dial_code: '+91',
    registration_number: '4190', is_archived: 0, date: '17/09/2026',
    customfield_data: [{ field_name: 'parent_name', field_value: 'Rema' }, { field_name: 'religion', field_value: 'x' }, { field_name: 'permanent_address', field_value: 'Kannur' }],
  });
  assert.equal(row.name, 'Anjali R');
  assert.equal(row.email, 'anjali@example.com');
  assert.equal(row.phone, '9876543210');
  assert.equal(row.registrationNo, 4190);
  assert.equal(row.archived, false);
  assert.equal(row.addedOn?.toISOString().slice(0, 10), '2026-09-17');
  assert.equal(row.profile.parentName, 'Rema');
  assert.equal(row.profile.permanentAddress, 'Kannur');
  assert.equal(JSON.stringify(row).includes('religion'), false);
  assert.equal(learnerRow({ user_id: 8, name: 'X', email: 'not-an-email' }).email, null);
});

test('a batch is placed by its dates unless archived', () => {
  const now = new Date('2026-09-17T00:00:00Z');
  const s = Math.floor(now.getTime() / 1000);
  assert.equal(batchState({ class_id: 1, class_name: 'a', mb_archived: 1 }, now), 'ARCHIVED');
  assert.equal(batchState({ class_id: 1, class_name: 'a', start_date: s - 86400 * 60, end_date: s - 86400 }, now), 'COMPLETED');
  assert.equal(batchState({ class_id: 1, class_name: 'a', start_date: s + 86400 * 7 }, now), 'UPCOMING');
  assert.equal(batchState({ class_id: 1, class_name: 'a', start_date: s - 86400, end_date: null }, now), 'ACTIVE');
  assert.equal(epochDate(0), null);
  assert.equal(epochDate(1789564112)?.getUTCFullYear(), 2026);
});

test('a package price is paise, rupees only, never for archived packages', () => {
  assert.equal(packagePaise({ package_id: 1, bundle_id: 2, cost: 12999, currency_symbol: '₹' }), 1299900);
  assert.equal(packagePaise({ package_id: 1, bundle_id: 2, cost: '499.5' }), 49950);
  assert.equal(packagePaise({ package_id: 1, bundle_id: 2, cost: 0 }), null);
  assert.equal(packagePaise({ package_id: 1, bundle_id: 2, cost: 100, currency_symbol: '$' }), null);
  assert.equal(packagePaise({ package_id: 1, bundle_id: 2, cost: 100, is_archived: 1 }), null);
});

test('a choice question keeps its options and the right one', () => {
  const rows = questionRows(0, {
    question_id: 5,
    question_JSON: '[""]',
    input_JSON: JSON.stringify([{ input_type: 0, marks: 2, neg_mark: 0.5, question_string: '<p>Capital of Kerala?</p>', options: [{ index: 0, option_string: 'Kochi' }, { index: 1, option_string: 'Thiruvananthapuram' }, { index: 2, option_string: 'Kozhikode' }], explanation: '' }]),
    answer_JSON: JSON.stringify([{ answer: [[1]], explanation: 'The capital.' }]),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'MCQ_SINGLE');
  assert.equal(rows[0].marks, 2);
  assert.equal(rows[0].negativeMarks, 0.5);
  assert.equal(rows[0].explanation, 'The capital.');
  assert.deepEqual(rows[0].options.map((o) => o.isCorrect), [false, true, false]);
});

test('several right answers make a multi-choice, a passage goes above each part', () => {
  const rows = questionRows(0, {
    question_id: 6,
    question_JSON: '["<p>Read the text.</p>"]',
    input_JSON: JSON.stringify([
      { input_type: 0, marks: 1, question_string: '<p>Q1</p>', options: [{ index: 0, option_string: 'a', is_correct: 1 }, { index: 1, option_string: 'b', is_correct: 1 }, { index: 2, option_string: 'c' }] },
      { input_type: 0, marks: 1, question_string: '<p>Q2</p>', options: [{ index: 0, option_string: 'a' }, { index: 1, option_string: 'b' }] },
    ]),
    answer_JSON: JSON.stringify([{ answer: [[0, 1]] }, { answer: [[1]] }]),
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'MCQ_MULTI');
  assert.equal(rows[1].type, 'MCQ_SINGLE');
  assert.ok(rows[1].promptHtml.startsWith('<p>Read the text.</p>'));
});

test('a blank keeps its accepted answers; a written task is marked by a person', () => {
  const blank = questionRows(2, { question_id: 7, input_JSON: JSON.stringify([{ input_type: 2, marks: 1, question_string: '<p>Area: 1 ... hectares</p>', options: [['69', 'sixty-nine']] }]), answer_JSON: JSON.stringify([{ answer: [['69', 'sixty-nine']] }]) });
  assert.equal(blank[0].type, 'FILL_BLANK');
  assert.deepEqual(blank[0].answerKey, { kind: 'FILL_BLANK', blanks: [['69', 'sixty-nine']], caseSensitive: false });
  const essay = questionRows(5, { question_id: 8, input_JSON: JSON.stringify([{ input_type: 5, marks: 9, question_string: '<p>Write a letter.</p>', options: [] }]), answer_JSON: JSON.stringify([{ answer: [[]] }]), sound_asset: { id: 1 } });
  assert.equal(essay[0].type, 'LONG_ANSWER');
  assert.equal(essay[0].mediaLeftBehind, true);
  assert.deepEqual(questionRows(0, { question_id: 9, is_removed: 1 }), []);
});
