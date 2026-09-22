import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { hexToRgb } from '@/lib/certificate';
import { embedPicture, wrap, safe as winAnsi, type PdfPicture } from '@/lib/certificate-pdf';

/** The standard fonts have no rupee sign; "Rs" reads the same on a label. */
function safe(s: string): string {
  return winAnsi(s.replace(/₹\s?/g, 'Rs ').replace(/\u2019/g, "'"));
}

/**
 * QR codes that look like the academy's rather than like a default.
 *
 * Two sheets, both A4, both drawn with pdf-lib so they render on shared
 * hosting: labels (eight to a page, for a printed batch of vouchers or a
 * stack of the same code to leave on a counter) and a poster (one code to
 * a page, for a wall or a window). The code is drawn in the brand colour
 * where it is dark enough to scan, with the academy's mark in the middle:
 * the error-correction level is set high enough that a small mark in the
 * centre costs nothing.
 *
 * Bytes in, bytes out; nothing here reads the database.
 */

export interface QrItem {
  /** What the code opens. */
  url: string;
  heading: string;
  /** Printed large under the heading, for typing when scanning is not an option. */
  code?: string | null;
  lines: string[];
}

export interface QrSheetInput {
  academy: string;
  accentHex: string;
  logo?: PdfPicture | null;
  layout: 'labels' | 'poster';
  items: QrItem[];
  /** One line at the foot of every label or poster. */
  footer?: string | null;
}

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 28;
const COLUMNS = 2;
const ROWS = 4;

export async function renderQrSheet(input: QrSheetInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.academy}: QR ${input.layout === 'labels' ? 'labels' : 'poster'}`);
  doc.setAuthor(input.academy);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const accent = hexToRgb(input.accentHex);
  const accentColor = rgb(accent.r, accent.g, accent.b);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.42, 0.42, 0.42);
  const line = rgb(0.85, 0.85, 0.85);
  const logo = await embedPicture(doc, input.logo);
  const qrHex = scannable(input.accentHex) ? input.accentHex : '#111111';

  const items = input.items.length ? input.items : [{ url: 'https://example.invalid', heading: 'Nothing to print', code: null, lines: [] }];

  if (input.layout === 'poster') {
    for (const item of items) {
      const page = doc.addPage([A4.w, A4.h]);
      page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: rgb(1, 1, 1) });
      page.drawRectangle({ x: 0, y: A4.h - 18, width: A4.w, height: 18, color: accentColor });
      const side = 320;
      const headingLines = wrap(bold, safe(item.heading), 30, A4.w - 2 * 60).slice(0, 3);
      const bodyLines = item.lines.flatMap((l) => wrap(text, safe(l), 14, A4.w - 2 * 80)).slice(0, 5);
      const codeHeight = item.code ? 40 : 0;
      const logoDims = logo ? fit(logo, 64, 64) : null;
      const blockHeight = (logoDims ? logoDims.h + 16 : 0) + 20 + 30 + headingLines.length * 36 + 16 + side + 26 + codeHeight + bodyLines.length * 20 + 24;
      let y = (A4.h - 18 + blockHeight) / 2;
      if (logo && logoDims) {
        page.drawImage(logo, { x: (A4.w - logoDims.w) / 2, y: y - logoDims.h, width: logoDims.w, height: logoDims.h });
        y -= logoDims.h + 16;
      }
      y -= 12;
      centred(page, bold, safe(input.academy), 13, y, accentColor, 1.5);
      y -= 38;
      for (const l of headingLines) {
        centred(page, bold, l, 30, y, ink);
        y -= 36;
      }
      y -= 16;
      const qr = await qrImage(doc, item.url, qrHex, 960);
      if (qr) {
        page.drawImage(qr, { x: (A4.w - side) / 2, y: y - side, width: side, height: side });
        overlayLogo(page, logo, (A4.w - side) / 2, y - side, side);
      }
      y -= side + 26;
      if (item.code) {
        centred(page, mono, safe(item.code), 30, y, ink, 2);
        y -= codeHeight;
      }
      for (const l of bodyLines) {
        centred(page, text, l, 14, y, muted);
        y -= 20;
      }
      y -= 4;
      centred(page, text, safe(shortUrl(item.url)), 10, y, muted);
      if (input.footer) centred(page, text, safe(input.footer), 9, 34, muted);
    }
    return doc.save();
  }

  const cellW = (A4.w - 2 * MARGIN) / COLUMNS;
  const cellH = (A4.h - 2 * MARGIN) / ROWS;
  const perPage = COLUMNS * ROWS;
  for (let i = 0; i < items.length; i += 1) {
    const page = i % perPage === 0 ? doc.addPage([A4.w, A4.h]) : doc.getPage(doc.getPageCount() - 1);
    const slot = i % perPage;
    const x0 = MARGIN + (slot % COLUMNS) * cellW;
    const y0 = A4.h - MARGIN - (Math.floor(slot / COLUMNS) + 1) * cellH;
    const item = items[i];
    page.drawRectangle({ x: x0 + 4, y: y0 + 4, width: cellW - 8, height: cellH - 8, borderColor: line, borderWidth: 0.6, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: x0 + 4, y: y0 + cellH - 4 - 5, width: cellW - 8, height: 5, color: accentColor });

    const pad = 12;
    const footerLines = input.footer ? wrap(text, safe(input.footer), 6.5, cellW - 2 * pad - 4).slice(0, 2) : [];
    const footerHeight = footerLines.length ? footerLines.length * 8.5 + 4 : 0;
    const side = Math.min(cellH - 2 * pad - 8 - footerHeight, 124);
    const top = y0 + cellH - 4 - 5 - pad;
    const qr = await qrImage(doc, item.url, qrHex, 480);
    if (qr) {
      page.drawImage(qr, { x: x0 + pad, y: top - side, width: side, height: side });
      overlayLogo(page, logo, x0 + pad, top - side, side);
    }

    const tx = x0 + pad + side + 10;
    const tw = cellW - (tx - x0) - pad;
    let y = top - 9;
    const academy = safe(input.academy).toUpperCase();
    spaced(page, bold, academy, fitSize(bold, academy, 7, tw, 0.6, 4.5), tx, y, accentColor, 0.6);
    y -= 17;
    for (const l of wrap(bold, safe(item.heading), 12, tw).slice(0, 2)) {
      page.drawText(l, { x: tx, y, size: 12, font: bold, color: ink });
      y -= 15;
    }
    if (item.code) {
      y -= 5;
      const size = fitSize(mono, safe(item.code), 14, tw, 0.3);
      spaced(page, mono, safe(item.code), size, tx, y, ink, 0.3);
      y -= 19;
    }
    for (const l of item.lines.flatMap((s) => wrap(text, safe(s), 8, tw)).slice(0, 6)) {
      if (y < top - side + 4) break;
      page.drawText(l, { x: tx, y, size: 8, font: text, color: muted });
      y -= 10.5;
    }
    let fy = y0 + pad + (footerLines.length - 1) * 8.5;
    for (const l of footerLines) {
      page.drawText(l, { x: x0 + pad, y: fy, size: 6.5, font: text, color: muted });
      fy -= 8.5;
    }
  }
  return doc.save();
}

/** A brand colour dark enough for a scanner against white; otherwise the code is drawn in ink. */
export function scannable(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.45;
}

function overlayLogo(page: PDFPage, logo: PDFImage | null, x: number, y: number, side: number) {
  if (!logo) return;
  const box = side * 0.22;
  const dims = fit(logo, box * 0.82, box * 0.82);
  const cx = x + side / 2;
  const cy = y + side / 2;
  page.drawRectangle({ x: cx - box / 2, y: cy - box / 2, width: box, height: box, color: rgb(1, 1, 1) });
  page.drawImage(logo, { x: cx - dims.w / 2, y: cy - dims.h / 2, width: dims.w, height: dims.h });
}

function fit(image: PDFImage, maxW: number, maxH: number): { w: number; h: number } {
  const scale = Math.min(maxW / image.width, maxH / image.height, 1e9);
  return { w: image.width * scale, h: image.height * scale };
}

function fitSize(font: PDFFont, s: string, size: number, maxWidth: number, spacing: number, floor = 7): number {
  let n = size;
  while (n > floor && font.widthOfTextAtSize(s, n) + spacing * (s.length - 1) > maxWidth) n -= 0.5;
  return n;
}

async function qrImage(doc: PDFDocument, url: string, dark: string, width: number): Promise<PDFImage | null> {
  try {
    const png = await QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'H', margin: 1, width, color: { dark, light: '#ffffff' } });
    return await doc.embedPng(png);
  } catch {
    return null;
  }
}

/** Letter-spaced text, drawn a character at a time since pdf-lib has no spacing option on drawText. */
function spaced(page: PDFPage, font: PDFFont, line: string, size: number, x: number, y: number, color: ReturnType<typeof rgb>, spacing: number) {
  if (!spacing) {
    page.drawText(line, { x, y, size, font, color });
    return;
  }
  let cx = x;
  for (const ch of line) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + spacing;
  }
}

function centred(page: PDFPage, font: PDFFont, line: string, size: number, y: number, color: ReturnType<typeof rgb>, spacing = 0) {
  const width = font.widthOfTextAtSize(line, size) + spacing * Math.max(0, line.length - 1);
  spaced(page, font, line, size, (A4.w - width) / 2, y, color, spacing);
}

/** The address without its scheme and trailing slash, as people read it off a poster. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
