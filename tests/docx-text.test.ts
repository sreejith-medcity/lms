import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { docxToText, paragraphsFromXml } from '../src/lib/docx-text';

/** A minimal zip with one deflated entry, enough to be a document. */
function zip(name: string, content: string): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const raw = Buffer.from(content, 'utf8');
  const data = deflateRawSync(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);

  const localPart = Buffer.concat([local, nameBuf, data]);
  const centralPart = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
}

const p = (text: string, level?: number) =>
  `<w:p>${level === undefined ? '' : `<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr>`}<w:r><w:t>${text}</w:t></w:r></w:p>`;

test('Word numbering that lives outside the text is written back in', () => {
  const xml = `<w:document><w:body>${[
    p('Which vitamin is fat soluble?', 0),
    p('Vitamin C', 1),
    p('Vitamin D', 1),
    p('Answer: B'),
    p('The heart has four chambers.', 0),
    p('Answer: True'),
  ].join('')}</w:body></w:document>`;
  assert.deepEqual(paragraphsFromXml(xml), [
    '1. Which vitamin is fat soluble?',
    'a) Vitamin C',
    'b) Vitamin D',
    'Answer: B',
    '2. The heart has four chambers.',
    'Answer: True',
  ]);
});

test('typed numbers are kept, entities decoded, tabs and breaks honoured', () => {
  const xml = `<w:body>${p('1. Salt is NaCl &amp; water is H&#8322;O', 0)}<w:p><w:r><w:t xml:space="preserve">a)</w:t><w:tab/><w:t>yes</w:t><w:br/><w:t>more</w:t></w:r></w:p></w:body>`;
  assert.deepEqual(paragraphsFromXml(xml), ['1. Salt is NaCl & water is H₂O', 'a)\tyes\nmore']);
});

test('a real zip with word/document.xml is read', () => {
  const doc = zip('word/document.xml', `<w:document><w:body>${p('Hello')}${p('World')}</w:body></w:document>`);
  assert.equal(docxToText(doc), 'Hello\nWorld');
});

test('something that is not a document says so', () => {
  assert.throws(() => docxToText(Buffer.from('not a zip')), /NOT_A_ZIP/);
  assert.throws(() => docxToText(zip('other.txt', 'x')), /NOT_A_DOCX/);
});
