import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { hexToRgb, merge, type CertificateDesign, type MergeValues } from '@/lib/certificate';

/**
 * The certificate as a file.
 *
 * A4 landscape, drawn with pdf-lib, which is plain JavaScript and so runs
 * on shared hosting where a headless browser would not. The layout is the
 * same one the web page shows: a background if the academy uploaded one,
 * otherwise a frame and a rule in the accent; the academy's mark; the
 * headline; the body with the learner's name and course merged in; the
 * signature above a line; the serial in one corner and a QR code to the
 * public verify page in the other, so a stranger with the paper can check
 * it without typing anything.
 *
 * Bytes in, bytes out: pictures arrive already fetched, so this is
 * testable without storage and reusable by the email that attaches it.
 */

export interface PdfPicture {
  bytes: Uint8Array;
  mimeType: string | null;
}

export interface CertificatePdfInput {
  design: CertificateDesign;
  values: MergeValues;
  verifyUrl: string;
  accentHex: string;
  background?: PdfPicture | null;
  signature?: PdfPicture | null;
  logo?: PdfPicture | null;
  revoked?: boolean;
}

const A4 = { w: 841.89, h: 595.28 };

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificate ${input.values.serial}`);
  doc.setAuthor(input.values.academy);
  const page = doc.addPage([A4.w, A4.h]);
  const serif = input.design.font === 'serif';
  const heading = await doc.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const text = await doc.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const small = await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const accent = hexToRgb(input.design.accent || input.accentHex);
  const accentColor = rgb(accent.r, accent.g, accent.b);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.4, 0.4, 0.4);

  const background = await embed(doc, input.background);
  if (background) {
    page.drawImage(background, { x: 0, y: 0, width: A4.w, height: A4.h });
  } else {
    page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: rgb(1, 1, 1) });
  }

  if (input.design.showFrame) {
    page.drawRectangle({ x: 24, y: 24, width: A4.w - 48, height: A4.h - 48, borderColor: accentColor, borderWidth: 1.2, opacity: 0, borderOpacity: 0.45 });
    page.drawRectangle({ x: 0, y: A4.h - 9, width: A4.w, height: 9, color: accentColor });
  }

  // The words sit in the upper two thirds, above the signature band, with
  // the extra room when there is no logo given to the top margin.
  const logo = input.design.showLogo ? await embed(doc, input.logo) : null;
  let cursor = A4.h - (logo ? 96 : 130);
  if (logo) {
    const h = 48;
    const w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: (A4.w - w) / 2, y: cursor - h + 10, width: Math.min(w, 200), height: h });
    cursor -= h + 10;
  }

  centred(page, small, safe(input.values.academy).toUpperCase(), 9.5, cursor, muted, 3);
  cursor -= 44;
  centred(page, heading, safe(input.design.headline), 32, cursor, accentColor);
  cursor -= 46;

  const body = safe(merge(input.design.body, input.values));
  const lines = wrap(text, body, 13, A4.w - 220);
  for (const line of lines) {
    centred(page, text, line, 13, cursor, ink);
    cursor -= 20;
  }

  // The bottom band: serial left, signature right, QR far right.
  const baseline = 86;
  if (input.design.showSerial) {
    page.drawText('CERTIFICATE NO.', { x: 70, y: baseline + 16, size: 7.5, font: small, color: muted });
    page.drawText(safe(input.values.serial), { x: 70, y: baseline, size: 11, font: mono, color: ink });
  }

  const qr = input.design.showQr ? await qrImage(doc, input.verifyUrl) : null;
  const qrSize = 78;
  if (qr) {
    page.drawImage(qr, { x: A4.w - 70 - qrSize, y: baseline - 14, width: qrSize, height: qrSize });
    page.drawText('Scan to verify', { x: A4.w - 70 - qrSize + 8, y: baseline - 24, size: 6.5, font: small, color: muted });
  }

  if (input.design.signatoryName || input.design.signatoryRole) {
    const right = qr ? A4.w - 70 - qrSize - 28 : A4.w - 70;
    const lineW = 170;
    const signature = await embed(doc, input.signature);
    if (signature) {
      const h = 46;
      const w = Math.min((signature.width / signature.height) * h, lineW);
      page.drawImage(signature, { x: right - lineW + (lineW - w) / 2, y: baseline + 22, width: w, height: h });
    }
    page.drawLine({ start: { x: right - lineW, y: baseline + 18 }, end: { x: right, y: baseline + 18 }, thickness: 0.8, color: rgb(0.6, 0.6, 0.6) });
    if (input.design.signatoryName) {
      const name = safe(input.design.signatoryName);
      page.drawText(name, { x: right - text.widthOfTextAtSize(name, 11), y: baseline + 4, size: 11, font: text, color: ink });
    }
    if (input.design.signatoryRole) {
      const role = safe(input.design.signatoryRole).toUpperCase();
      page.drawText(role, { x: right - small.widthOfTextAtSize(role, 7.5), y: baseline - 8, size: 7.5, font: small, color: muted });
    }
  }

  if (input.revoked) {
    const label = 'WITHDRAWN';
    const size = 96;
    page.drawText(label, {
      x: (A4.w - heading.widthOfTextAtSize(label, size)) / 2 + 40,
      y: A4.h / 2 - 90,
      size,
      font: heading,
      color: rgb(0.85, 0.1, 0.1),
      opacity: 0.16,
      rotate: { type: 'degrees', angle: 18 } as never,
    });
  }

  return doc.save();
}

async function embed(doc: PDFDocument, pic: PdfPicture | null | undefined): Promise<PDFImage | null> {
  if (!pic || pic.bytes.byteLength === 0) return null;
  const mime = (pic.mimeType ?? '').toLowerCase();
  try {
    if (mime.includes('png') || looksPng(pic.bytes)) return await doc.embedPng(pic.bytes);
    return await doc.embedJpg(pic.bytes);
  } catch {
    // A WebP or SVG we cannot place. Better a certificate without the
    // picture than no certificate.
    return null;
  }
}

function looksPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

async function qrImage(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const png = await QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 240 });
    return await doc.embedPng(png);
  } catch {
    return null;
  }
}

function centred(page: PDFPage, font: PDFFont, line: string, size: number, y: number, color: ReturnType<typeof rgb>, spacing = 0) {
  const width = font.widthOfTextAtSize(line, size) + spacing * Math.max(0, line.length - 1);
  page.drawText(line, { x: (A4.w - width) / 2, y, size, font, color, ...(spacing ? { characterSpacing: spacing } : {}) });
}

/** Greedy wrap by measured width, so a long course title never runs off the page. */
export function wrap(font: PDFFont, body: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of body.split(/\n+/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth || !line) line = trial;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * The standard fonts know Latin-1 and not much else. A Malayalam name would
 * throw rather than print, so anything outside that range is transliterated
 * where a plain equivalent exists and dropped where it does not. A name
 * drawn wrong is worse than a name with a letter missing, and an academy
 * that needs its own script gets a font of its own in a later change.
 */
export function safe(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, (m) => (KEEP_DIACRITIC.has(m) ? m : ''))
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, '-')
    .replace(/[^\x20-\x7e -ÿ€]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Umlauts and the like survive NFKD-then-NFC; combining marks with no precomposed Latin-1 form are dropped. */
const KEEP_DIACRITIC = new Set(['̀', '́', '̂', '̃', '̈', '̊', '̧']);
