import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, extractBlocks, textOf } from '../src/lib/import-page';

const PAGE = `<!doctype html><html><head><title>NCLEX-RN Course | Medcity</title>
<script>var tracking = 1;</script><style>.x{color:red}</style></head>
<body>
<header><nav><ul><li>Home</li><li>Courses</li><li>About</li><li>Contact</li><li>Blog</li></ul></nav></header>
<main>
  <h1>NCLEX-RN Course</h1>
  <p>Prepare for the NCLEX-RN with a structured plan &amp; live classes.</p>
  <p>Taught by nurses who have cleared it themselves.</p>
  <h2>What you will learn</h2>
  <ul><li>Pharmacology for the exam</li><li>Prioritisation and delegation</li><li>Practice under timed conditions</li></ul>
  <img src="https://cdn.example.com/classroom.jpg" alt="A class in progress">
  <img src="https://cdn.example.com/spacer.png" alt="">
  <h2>Frequently asked</h2>
  <div class="elementor-tab-title">How long is the course?</div>
  <div class="elementor-tab-content"><p>Six months, with weekend batches.</p></div>
  <div class="elementor-tab-title">Do I get recordings?</div>
  <div class="elementor-tab-content"><p>Yes, for the full validity period.</p></div>
  <iframe src="https://youtube.com/embed/x"></iframe>
</main>
<footer><p>Copyright 2026</p></footer>
</body></html>`;

test('the words come across and the markup does not', () => {
  const { title, blocks } = extractBlocks(PAGE);

  assert.equal(title, 'NCLEX-RN Course');
  assert.deepEqual(blocks.map((b) => b.type), ['text', 'bullets', 'image', 'faq']);

  const text = blocks[0];
  assert.ok(text.type === 'text' && text.body.includes('structured plan & live classes'));
  assert.ok(text.type === 'text' && text.body.includes('\n\n'), 'two paragraphs are kept apart');
  assert.ok(!JSON.stringify(blocks).includes('<'), 'no markup survives');
});

test('a heading carries the block that follows it', () => {
  const [, bullets] = extractBlocks(PAGE).blocks;
  assert.equal(bullets.type === 'bullets' && bullets.heading, 'What you will learn');
  assert.equal(bullets.type === 'bullets' && bullets.items.length, 3);
});

test('an accordion becomes questions and answers', () => {
  const faq = extractBlocks(PAGE).blocks.find((b) => b.type === 'faq');
  assert.ok(faq && faq.type === 'faq');
  assert.deepEqual(faq.items, [
    { q: 'How long is the course?', a: 'Six months, with weekend batches.' },
    { q: 'Do I get recordings?', a: 'Yes, for the full validity period.' },
  ]);
});

test('the navigation, the footer and the scripts are left behind', () => {
  const json = JSON.stringify(extractBlocks(PAGE).blocks);
  for (const junk of ['Home', 'Copyright 2026', 'tracking', 'color:red']) {
    assert.ok(!json.includes(junk), `${junk} came across`);
  }
});

test('spacers and icons are not imported as pictures', () => {
  const images = extractBlocks(PAGE).blocks.filter((b) => b.type === 'image');
  assert.equal(images.length, 1);
  assert.equal(images[0].type === 'image' && images[0].url, 'https://cdn.example.com/classroom.jpg');
});

test('an embedded video is reported rather than silently dropped', () => {
  const { notes } = extractBlocks(PAGE);
  assert.ok(notes.some((n) => /frame/i.test(n)), notes.join(' | '));
});

test('a lazy loaded image is taken from where the real file is', () => {
  const { blocks } = extractBlocks(
    `<body><main><p>${'word '.repeat(60)}</p><img src="https://cdn.example.com/placeholder.png" data-src="https://cdn.example.com/real-photo.jpg" alt="Real"></main></body>`,
  );
  const image = blocks.find((b) => b.type === 'image');
  assert.equal(image?.type === 'image' && image.url, 'https://cdn.example.com/real-photo.jpg');
});

test('an http image is refused, because the page it lands on is https', () => {
  const { blocks } = extractBlocks('<body><main><img src="http://cdn.example.com/a.jpg"></main></body>');
  assert.equal(blocks.filter((b) => b.type === 'image').length, 0);
});

test('the same paragraph twice, from a mobile copy of a section, appears once', () => {
  const { blocks } = extractBlocks(
    '<body><main><p>Kochi, Kottayam and Kollam.</p><p>Kochi, Kottayam and Kollam.</p></main></body>',
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type === 'text' && blocks[0].body, 'Kochi, Kottayam and Kollam.');
});

test('a page of nothing says so instead of returning an empty page silently', () => {
  const { blocks, notes } = extractBlocks('<body><main><img src="https://x.example/hero-icon.png"></main></body>');
  assert.deepEqual(blocks, []);
  assert.ok(notes.some((n) => /nothing readable/i.test(n)));
});

test('entities are decoded, including numeric and rupee', () => {
  assert.equal(decodeEntities('Fee &#8377;45,000 &amp; up &#x2014; today'), 'Fee ₹45,000 & up — today');
  assert.equal(textOf('<p>A <strong>bold</strong> claim</p>'), 'A bold claim');
});

test('nothing at all is not a crash', () => {
  assert.deepEqual(extractBlocks('').blocks, []);
  assert.deepEqual(extractBlocks('<html></html>').blocks, []);
});
