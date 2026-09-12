import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { safe, wrap } from '@/lib/certificate-pdf';
import type { ReportCardData, ReportCardRow } from '@/lib/report-card';

/**
 * The report card as a file. A4 portrait: the academy and the learner at
 * the top, attendance as one line, then a table each for tests and
 * homework with the percentage and the grade, the overall figure in a
 * band of its own, and the trainer's remark last, because that is the
 * line a parent reads twice.
 */

const A4 = { w: 595.28, h: 841.89 };
const M = 48;

export interface ReportCardPdfInput {
  academy: string;
  learner: string;
  course: string;
  batch: string | null;
  title: string;
  period: string;
  issuedOn: string;
  remark: string | null;
  data: ReportCardData;
  accentHex?: string;
  logo?: { bytes: Uint8Array; mimeType: string | null } | null;
}

export async function renderReportCardPdf(input: ReportCardPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.title}: ${input.learner}`);
  pdf.setAuthor(input.academy);
  let page = pdf.addPage([A4.w, A4.h]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.42, 0.42, 0.42);
  const line = rgb(0.85, 0.85, 0.85);
  const accent = hex(input.accentHex ?? '#322046');
  let y = A4.h - M;

  const ensure = (need: number) => {
    if (y - need < M + 20) {
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - M;
    }
  };

  if (input.logo) {
    try {
      const img = input.logo.mimeType?.includes('png') ? await pdf.embedPng(input.logo.bytes) : await pdf.embedJpg(input.logo.bytes);
      const h = 32;
      page.drawImage(img, { x: M, y: y - h, width: Math.min((img.width / img.height) * h, 140), height: h });
      y -= h + 10;
    } catch {
      /* the name below still says who this is from */
    }
  }
  page.drawText(safe(input.academy), { x: M, y, size: 12, font: bold, color: ink });
  right(page, bold, safe(input.title).toUpperCase(), 14, A4.w - M, y, accent);
  y -= 16;
  page.drawText(safe(input.period), { x: M, y, size: 9, font: text, color: muted });
  right(page, text, `Issued ${input.issuedOn}`, 9, A4.w - M, y, muted);
  y -= 22;
  page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.8, color: line });
  y -= 22;

  page.drawText(safe(input.learner), { x: M, y, size: 15, font: bold, color: ink });
  y -= 16;
  page.drawText(safe([input.course, input.batch].filter(Boolean).join(' · ')), { x: M, y, size: 10, font: text, color: muted });
  y -= 26;

  // Attendance, one band.
  const a = input.data.attendance;
  page.drawRectangle({ x: M, y: y - 10, width: A4.w - 2 * M, height: 30, color: rgb(0.96, 0.96, 0.97) });
  page.drawText('ATTENDANCE', { x: M + 10, y, size: 7.5, font: bold, color: muted });
  const attendanceText = a.held === 0 ? 'No classes held in this period' : `${a.attended} of ${a.held} classes${a.late ? `, ${a.late} late` : ''}`;
  page.drawText(attendanceText, { x: M + 90, y, size: 10, font: text, color: ink });
  if (a.percent !== null) right(page, bold, `${a.percent}%${a.grade ? `  ${a.grade}` : ''}`, 11, A4.w - M - 10, y, ink);
  y -= 36;

  const table = (heading: string, rows: ReportCardRow[], empty: string) => {
    ensure(60);
    page.drawText(heading.toUpperCase(), { x: M, y, size: 7.5, font: bold, color: muted });
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.6, color: line });
    y -= 16;
    if (rows.length === 0) {
      page.drawText(empty, { x: M, y, size: 9.5, font: text, color: muted });
      y -= 22;
      return;
    }
    for (const r of rows) {
      ensure(24);
      const lines = wrap(text, safe(r.title), 10, A4.w - 2 * M - 220);
      page.drawText(lines[0], { x: M, y, size: 10, font: text, color: ink });
      page.drawText(safe(r.on), { x: A4.w - M - 200, y, size: 8.5, font: text, color: muted });
      page.drawText(safe(r.note), { x: A4.w - M - 130, y, size: 8.5, font: text, color: muted });
      right(page, text, `${r.percent}%`, 10, A4.w - M - 34, y, ink);
      right(page, bold, r.grade ?? '-', 10, A4.w - M, y, ink);
      y -= 14;
      for (const extra of lines.slice(1)) {
        page.drawText(extra, { x: M, y, size: 10, font: text, color: ink });
        y -= 14;
      }
    }
    y -= 10;
  };
  table('Tests', input.data.tests, 'No tests released in this period.');
  table('Homework', input.data.homework, 'No homework marked in this period.');

  // Overall.
  ensure(60);
  y -= 14;
  const o = input.data.overall;
  page.drawRectangle({ x: M, y: y - 14, width: A4.w - 2 * M, height: 40, color: accent, opacity: 0.08 });
  page.drawText('OVERALL', { x: M + 10, y: y + 4, size: 7.5, font: bold, color: muted });
  if (o.percent === null) {
    page.drawText('Nothing to average yet.', { x: M + 90, y: y + 2, size: 10, font: text, color: muted });
  } else {
    page.drawText(`${o.percent}%`, { x: M + 90, y: y - 2, size: 18, font: bold, color: ink });
    if (o.grade) {
      right(page, bold, o.grade, 18, A4.w - M - 10, y - 2, accent);
      if (o.label) right(page, text, safe(o.label), 8.5, A4.w - M - 10, y - 14, muted);
    }
  }
  y -= 44;

  if (input.remark) {
    ensure(50);
    page.drawText("TRAINER'S REMARK", { x: M, y, size: 7.5, font: bold, color: muted });
    y -= 14;
    for (const w of wrap(text, safe(input.remark), 10, A4.w - 2 * M)) {
      ensure(14);
      page.drawText(w, { x: M, y, size: 10, font: text, color: ink });
      y -= 14;
    }
  }

  page.drawText('Grades follow the academy\'s published scale. Tests show the best released attempt; homework the latest marked hand-in.', { x: M, y: M - 12, size: 7.5, font: text, color: muted });
  return pdf.save();
}

function right(page: PDFPage, font: PDFFont, s: string, size: number, rightX: number, y: number, color: ReturnType<typeof rgb>) {
  page.drawText(s, { x: rightX - font.widthOfTextAtSize(s, size), y, size, font, color });
}

function hex(h: string) {
  const ok = /^#[0-9a-fA-F]{6}$/.test(h) ? h : '#322046';
  return rgb(parseInt(ok.slice(1, 3), 16) / 255, parseInt(ok.slice(3, 5), 16) / 255, parseInt(ok.slice(5, 7), 16) / 255);
}
