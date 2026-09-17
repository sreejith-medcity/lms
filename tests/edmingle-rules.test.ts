import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleSlug, inOrder, matchAsset, plainText, planMaterial } from '../src/lib/edmingle-rules';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

test('a material becomes the right kind of lesson', () => {
  assert.equal(planMaterial({ material_id: 1, material_name: 'x', type: 'video/mp4', material_source: 'file', file_name: 'a.mp4' }).type, 'VIDEO');
  assert.equal(planMaterial({ material_id: 1, material_name: 'x', type: 'video/mp4', material_source: 'file' }).video, true);
  assert.equal(planMaterial({ material_id: 2, material_name: 'x', type: 'application/pdf', material_source: 'file', file_name: 'a.pdf' }).type, 'PDF');
  assert.equal(planMaterial({ material_id: 2, material_name: 'x', type: 'application/pdf', material_source: 'file' }).video, false);
  assert.equal(planMaterial({ material_id: 3, material_name: 'x', material_source: 'youtube', external_url: 'https://www.youtube.com/watch?v=abc' }).type, 'YOUTUBE');
  assert.equal(planMaterial({ material_id: 3, material_name: 'x', material_source: 'link', external_url: 'https://youtu.be/abc' }).type, 'YOUTUBE');
  assert.equal(planMaterial({ material_id: 4, material_name: 'x', material_source: 'link', external_url: 'https://example.com/page' }).type, 'LINK_EMBED');
  assert.equal(planMaterial({ material_id: 5, material_name: 'x', html_text: '<p>Hello</p>' }).type, 'TEXT_HTML');
  assert.equal(planMaterial({ material_id: 6, material_name: 'x', type: '', material_source: 'file', file_name: 'deck.MOV' }).type, 'VIDEO');
  assert.equal(planMaterial({ material_id: 7, material_name: 'x', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', material_source: 'file', file_name: 'd.pptx' }).type, 'SLIDE');
});

test('order follows the display index, then the listing', () => {
  const out = inOrder([{ n: 'b', display_index: 2 }, { n: 'a', display_index: 1 }, { n: 'c' }]);
  assert.deepEqual(out.map((x) => x.n), ['a', 'b', 'c']);
});

test('a file is matched to its asset by name, narrowed by size, never guessed', () => {
  const assets = [
    { asset_id: 1, file_name: 'Notes.pdf', file_size_bytes: 100 },
    { asset_id: 2, file_name: 'notes.pdf', file_size_bytes: 200 },
    { asset_id: 3, file_name: 'other.pdf', file_size_bytes: 300 },
    { asset_id: 4, asset_name: 'Grammar sheet', file_name: 'g1.pdf', file_size_bytes: 10 },
  ];
  assert.equal(matchAsset({ material_id: 9, material_name: 'x', file_name: 'other.pdf' }, assets).asset?.asset_id, 3);
  assert.equal(matchAsset({ material_id: 9, material_name: 'x', file_name: 'Notes.pdf', file_size: 200 }, assets).asset?.asset_id, 2);
  assert.equal(matchAsset({ material_id: 9, material_name: 'x', file_name: 'Notes.pdf' }, assets).asset, null);
  assert.equal(matchAsset({ material_id: 9, material_name: 'Grammar sheet', file_name: 'missing.pdf' }, assets).asset?.asset_id, 4);
  assert.equal(matchAsset({ material_id: 9, material_name: 'x', file_name: '' }, assets).reason, 'no file name');
});

test('the slug comes from the pretty name where Edmingle set one', () => {
  assert.equal(bundleSlug({ bundle_id: 1, bundle_name: 'German Language - A1', pretty_name: 'german-a1', course_ids: [] }, slug), 'german-a1');
  assert.equal(bundleSlug({ bundle_id: 1, bundle_name: 'German Language - A1', course_ids: [] }, slug), 'german-language-a1');
  assert.equal(bundleSlug({ bundle_id: 7, bundle_name: '???', course_ids: [] }, slug), 'course-7');
});

test('descriptions lose their markup and keep their lines', () => {
  assert.equal(plainText('<p>One &amp; two</p><p>Three<br>Four</p>'), 'One & two\nThree\nFour');
  assert.equal(plainText(null), '');
});
