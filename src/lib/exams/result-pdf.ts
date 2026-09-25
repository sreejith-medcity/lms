import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { embedPicture, safe, wrap, type PdfPicture } from '@/lib/certificate-pdf';

/**
 * A mock test result as a one-page A4 PDF: the academy, the candidate, the
 * test, the score with each part and the pass conditions, and a line saying
 * plainly that this is a practice paper, not the exam's certificate. Bytes
 * in, bytes out, so it is tested without storage.
 */

export interface ResultPdfInput {
  academy: string;
  accentHex: string;
  logo?: PdfPicture | null;
  candidate: string;
  test: string;
  subtitle: string;
  date: string;
  mode: string;
  reference: string;
  total: number | null;
  maxPoints: number | null;
  passed: boolean | null;
  modules: { name: string; points: number | null; max: number }[];
  conditions: { name: string; met: boolean; got: number; min: number; max: number }[];
  note: string;
}

const A4 = { w: 595.28, h: 841.89 };
const M = 56;

function hex(h: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  const n = m ? parseInt(m[1], 16) : 0x322046;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const fmt = (n: number | null) => (n == null ? '-' : String(Math.round(n * 10) / 10));

function right(page: PDFPage, font: PDFFont, text: string, size: number, x: number, y: number, color = rgb(0.07, 0.07, 0.07)) {
  page.drawText(text, { x: x - font.widthOfTextAtSize(text, size), y, size, font, color });
}

export async function renderResultPdf(input: ResultPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Mock test result ${input.reference}`);
  doc.setAuthor(safe(input.academy));
  const page = doc.addPage([A4.w, A4.h]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = await doc.embedFont(StandardFonts.Helvetica);
  const accent = hex(input.accentHex);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.42, 0.42, 0.42);
  const ok = rgb(0.1, 0.5, 0.25);
  const bad = rgb(0.7, 0.15, 0.15);

  page.drawRectangle({ x: 0, y: A4.h - 8, width: A4.w, height: 8, color: accent });
  let y = A4.h - M;
  const logo = await embedPicture(doc, input.logo);
  if (logo) {
    const h = 36;
    const w = Math.min(160, (logo.width / logo.height) * h);
    page.drawImage(logo, { x: M, y: y - h + 8, width: w, height: h });
  }
  right(page, bold, safe(input.academy).toUpperCase(), 9, A4.w - M, y, muted);
  right(page, bold, 'MOCK TEST RESULT', 13, A4.w - M, y - 18, accent);
  y -= 76;

  page.drawText(safe(input.candidate), { x: M, y, size: 22, font: bold, color: ink });
  y -= 24;
  page.drawText(safe(`${input.test} (${input.subtitle})`), { x: M, y, size: 12.5, font: text, color: ink });
  y -= 16;
  page.drawText(safe(`${input.date} · ${input.mode} · paper ${input.reference}`), { x: M, y, size: 9.5, font: text, color: muted });
  y -= 44;

  /* The score band. */
  page.drawRectangle({ x: M, y: y - 22, width: A4.w - 2 * M, height: 58, color: accent, opacity: 0.07 });
  page.drawText(`${fmt(input.total)}`, { x: M + 16, y: y - 4, size: 30, font: bold, color: ink });
  page.drawText(`of ${fmt(input.maxPoints)} points`, { x: M + 16 + bold.widthOfTextAtSize(fmt(input.total), 30) + 8, y: y + 2, size: 11, font: text, color: muted });
  if (input.passed != null) right(page, bold, input.passed ? 'PASSED' : 'NOT YET PASSED', 14, A4.w - M - 16, y + 2, input.passed ? ok : bad);
  y -= 64;

  page.drawText('The parts', { x: M, y, size: 11, font: bold, color: ink });
  y -= 8;
  for (const m of input.modules) {
    y -= 22;
    page.drawLine({ start: { x: M, y: y - 6 }, end: { x: A4.w - M, y: y - 6 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.85) });
    page.drawText(safe(m.name), { x: M, y, size: 10.5, font: text, color: ink });
    const barX = M + 230;
    const barW = 170;
    page.drawRectangle({ x: barX, y: y - 1, width: barW, height: 7, color: rgb(0.92, 0.92, 0.92) });
    if (m.points != null) page.drawRectangle({ x: barX, y: y - 1, width: Math.max(0, Math.min(1, m.points / m.max)) * barW, height: 7, color: accent });
    right(page, bold, `${fmt(m.points)} / ${m.max}`, 10.5, A4.w - M, y, ink);
  }
  y -= 34;

  if (input.conditions.length) {
    page.drawText('Pass conditions', { x: M, y, size: 11, font: bold, color: ink });
    for (const c of input.conditions) {
      y -= 18;
      page.drawText(safe(`${c.met ? 'Met' : 'Not met'}: ${c.name}, ${fmt(c.got)} of ${c.max} (at least ${c.min})`), { x: M, y, size: 10, font: text, color: c.met ? ok : bad });
    }
    y -= 30;
  }

  for (const line of wrap(text, safe(input.note), 9, A4.w - 2 * M)) {
    page.drawText(line, { x: M, y, size: 9, font: text, color: muted });
    y -= 13;
  }

  page.drawText(safe(`Reference ${input.reference}`), { x: M, y: 40, size: 8, font: text, color: muted });
  return doc.save();
}
