import { inflateRawSync } from 'node:zlib';

/**
 * The text of a Word document, one paragraph per line.
 *
 * A .docx is a zip with the body in word/document.xml. Reading it needs a
 * zip walker and an XML skim, both small enough to write here rather than
 * pull in a library for. What comes out is deliberately plain: paragraphs,
 * tabs, line breaks, and the numbering Word would have shown.
 *
 * That last part is the one that matters for question lists. Word's
 * automatic numbering is not in the text; a paragraph carries a list level
 * and Word draws the "1." at render time. So a level-0 list item is
 * prefixed with a running number and a nested item with a letter, which is
 * how the trainer saw it and how the question parser expects it.
 */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

function entries(buffer: Buffer): ZipEntry[] {
  // End of central directory: scan back from the end for the signature.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('NOT_A_ZIP');

  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('BAD_CENTRAL_DIRECTORY');
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const offset = buffer.readUInt32LE(p + 42);
    const name = buffer.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    out.push({ name, method, compressedSize, offset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

function read(buffer: Buffer, entry: ZipEntry): Buffer {
  const p = entry.offset;
  if (buffer.readUInt32LE(p) !== 0x04034b50) throw new Error('BAD_LOCAL_HEADER');
  const nameLength = buffer.readUInt16LE(p + 26);
  const extraLength = buffer.readUInt16LE(p + 28);
  const start = p + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error('UNSUPPORTED_COMPRESSION');
}

export function docxDocumentXml(buffer: Buffer): string {
  const entry = entries(buffer).find((e) => e.name === 'word/document.xml');
  if (!entry) throw new Error('NOT_A_DOCX');
  return read(buffer, entry).toString('utf8');
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

function decode(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)));
}

const LETTERS = 'abcdefghij';

/** Paragraph text from the body XML, with list numbering written back in. */
export function paragraphsFromXml(xml: string): string[] {
  const out: string[] = [];
  let number = 0;
  let letter = 0;

  const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g) ?? [];
  for (const p of paragraphs) {
    let text = '';
    const runs = p.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:t\b[^>]*\/>|<w:tab\/>|<w:br\/>|<w:cr\/>/g) ?? [];
    for (const r of runs) {
      if (r === '<w:tab/>') text += '\t';
      else if (r === '<w:br/>' || r === '<w:cr/>') text += '\n';
      else if (r.endsWith('/>')) continue;
      else text += decode(r.replace(/^<w:t\b[^>]*>/, '').replace(/<\/w:t>$/, ''));
    }

    const listed = /<w:numPr>/.test(p);
    if (listed) {
      const level = Number(/<w:ilvl\s+w:val="(\d+)"/.exec(p)?.[1] ?? '0');
      // Text that already carries its own number keeps it.
      if (/^\s*(\d+[.)]|[a-jA-J][.)])\s/.test(text)) {
        out.push(text);
        continue;
      }
      if (level === 0) {
        number += 1;
        letter = 0;
        text = `${number}. ${text}`;
      } else {
        text = `${LETTERS[Math.min(letter, LETTERS.length - 1)]}) ${text}`;
        letter += 1;
      }
    }
    out.push(text);
  }
  return out;
}

export function docxToText(buffer: Buffer): string {
  return paragraphsFromXml(docxDocumentXml(buffer)).join('\n');
}
