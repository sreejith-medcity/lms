import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubjects } from '../src/lib/import-subjects';

const HEADER = 'Name,Tagline,Button,Image URL,Coming soon,Order';

test('a file written the obvious way reads correctly', () => {
  const { rows, problems } = parseSubjects(
    `${HEADER}\n` +
      `German Language Course,"Build A1–C2 speaking, listening, reading and writing skills.",Browse German courses,https://example.com/german.webp,no,1\n` +
      `Banking Course,Exam-focused preparation for banking careers.,,https://example.com/banking.webp,yes,5\n`,
  );

  assert.deepEqual(problems, []);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].slug, 'german-language-course');
  assert.equal(rows[0].comingSoon, false);
  assert.equal(rows[0].sortOrder, 1);
  // The comma inside the quoted tagline must survive.
  assert.match(rows[0].tagline, /speaking, listening, reading/);
  assert.equal(rows[1].comingSoon, true);
  assert.equal(rows[1].ctaLabel, '');
});

test('header names are matched on their letters, not their punctuation', () => {
  // The same file typed by three different people.
  for (const header of ['Name,Coming Soon', 'name,coming_soon', 'NAME,comingSoon']) {
    const { rows } = parseSubjects(`${header}\nBanking,yes\n`);
    assert.equal(rows.length, 1, header);
    assert.equal(rows[0].comingSoon, true, header);
  }
});

test('a file with no name column says so instead of importing nothing quietly', () => {
  const { rows, problems } = parseSubjects('Tagline,Button\nsomething,else\n');
  assert.equal(rows.length, 0);
  assert.match(problems[0], /No column of names/);
});

test('the same subject twice is reported rather than silently overwritten', () => {
  const { rows, problems } = parseSubjects(
    `${HEADER}\nGerman Course,a,,,,\nGerman  course,b,,,,\n`,
  );
  assert.equal(rows.length, 1);
  assert.match(problems[0], /same subject as row 2/);
});

test('a picture that is not https is dropped, and the subject still imports', () => {
  const { rows, problems } = parseSubjects(`${HEADER}\nGerman,a,,http://example.com/x.png,,\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].imageUrl, '');
  assert.match(problems[0], /not an https address/);
});

test('order defaults to the order the rows are in', () => {
  const { rows } = parseSubjects('Name\nFirst\nSecond\nThird\n');
  assert.deepEqual(rows.map((r) => r.sortOrder), [0, 1, 2]);
});

test('showOnHome defaults to yes, because a file of subjects is a list of what to show', () => {
  const { rows } = parseSubjects('Name\nGerman\n');
  assert.equal(rows[0].showOnHome, true);
});

test('an empty file is refused with words rather than a crash', () => {
  assert.match(parseSubjects('').problems[0], /nothing in it/);
  assert.match(parseSubjects('Name\n').problems[0], /No rows with a name/);
});

test('every one of the ten real subjects survives the round trip', () => {
  const real =
    `${HEADER}\n` +
    `German Language Course,"Build A1–C2 speaking, listening, reading and writing skills.",Browse German courses,https://medcitylms.in/a.webp,no,1\n` +
    `NCLEX-RN Course,"Structured NCLEX-RN preparation with concepts, practice and exam strategy.",View NCLEX-RN,https://medcitylms.in/b.webp,no,2\n` +
    `GCC Nursing Exam Course,"Prepare for DHA, MOH, HAAD and Prometric nursing licensing exams.",Browse nursing courses,https://medcitylms.in/c.webp,no,3\n` +
    `English Language Course,"Improve spoken English, grammar, vocabulary and workplace communication.",Browse English courses,https://medcitylms.in/d.webp,no,4\n` +
    `Banking Course,Exam-focused preparation for banking careers and competitive tests.,,https://medcitylms.in/e.webp,yes,5\n` +
    `Kerala PSC Course,Syllabus-based preparation and practice for Kerala PSC examinations.,,https://medcitylms.in/f.webp,yes,6\n` +
    `Central PSC Course,Foundation preparation for central government competitive examinations.,,https://medcitylms.in/g.webp,yes,7\n` +
    `Paramedical Courses,Career-focused skill development for paramedical and allied health professionals.,,https://medcitylms.in/h.webp,yes,8\n` +
    `Entrance Exam Courses,Focused preparation and practice for major entrance examinations.,,https://medcitylms.in/i.webp,yes,9\n` +
    `The Complete Digital Marketing Course,"Build practical skills in SEO, social media, content and paid campaigns.",,https://medcitylms.in/j.webp,yes,10\n`;

  const { rows, problems } = parseSubjects(real);
  assert.deepEqual(problems, []);
  assert.equal(rows.length, 10);
  assert.equal(rows.filter((r) => r.comingSoon).length, 6);
  assert.equal(rows.filter((r) => !r.comingSoon).length, 4);
  assert.equal(rows[9].slug, 'the-complete-digital-marketing-course');
});
