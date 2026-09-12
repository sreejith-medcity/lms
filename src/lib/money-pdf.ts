import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { safe, wrap } from '@/lib/certificate-pdf';
import type { MoneyDocumentData } from '@/lib/money-documents';

/**
 * A receipt or an invoice as a file: A4 portrait, the same content as the
 * printable page, drawn with pdf-lib so it can be attached to the email
 * that says the payment went through and filed by the office without a
 * browser. Amounts are written as "INR 7,000.00": the rupee sign is not in
 * the fonts a PDF carries by default, and a currency code is what an
 * accountant's software wants anyway.
 */

const A4 = { w: 595.28, h: 841.89 };
const M = 48;

export interface MoneyPdfInput {
  doc: MoneyDocumentData;
  accentHex?: string;
  logo?: { bytes: Uint8Array; mimeType: string | null } | null;
}

export function moneyText(paise: number, currency: string): string {
  const sign = paise < 0 ? '-' : '';
  const n = Math.abs(paise) / 100;
  return `${sign}${currency} ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function renderMoneyPdf(input: MoneyPdfInput): Promise<Uint8Array> {
  const d = input.doc;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${d.kind === 'INVOICE' ? 'Tax invoice' : 'Receipt'} ${d.number}`);
  pdf.setAuthor(d.issuer.name);
  const page = pdf.addPage([A4.w, A4.h]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.42, 0.42, 0.42);
  const line = rgb(0.85, 0.85, 0.85);
  const accent = hex(input.accentHex ?? '#322046');

  let y = A4.h - M;

  // Header: mark and issuer left, title and number right.
  if (input.logo) {
    try {
      const img = input.logo.mimeType?.includes('png') ? await pdf.embedPng(input.logo.bytes) : await pdf.embedJpg(input.logo.bytes);
      const h = 34;
      page.drawImage(img, { x: M, y: y - h, width: Math.min((img.width / img.height) * h, 140), height: h });
      y -= h + 8;
    } catch {
      /* a format the PDF cannot place; the name below still says who this is from */
    }
  }
  const issuerLines = [
    d.issuer.legalName || d.issuer.name,
    [d.issuer.addressLine, d.issuer.city, d.issuer.state, d.issuer.pincode].filter(Boolean).join(', '),
    d.issuer.gstin ? `GSTIN ${d.issuer.gstin}` : '',
    d.issuer.pan ? `PAN ${d.issuer.pan}` : '',
    [d.issuer.supportEmail, d.issuer.contactNumber].filter(Boolean).join(' · '),
  ].filter(Boolean);
  let ly = y;
  page.drawText(safe(issuerLines[0]), { x: M, y: ly, size: 12, font: bold, color: ink });
  ly -= 15;
  for (const l of issuerLines.slice(1)) {
    for (const w of wrap(text, safe(l), 9, 280)) {
      page.drawText(w, { x: M, y: ly, size: 9, font: text, color: muted });
      ly -= 12;
    }
  }

  const title = d.kind === 'INVOICE' ? 'TAX INVOICE' : 'RECEIPT';
  right(page, bold, title, 16, A4.w - M, y, accent);
  right(page, text, safe(d.number), 11, A4.w - M, y - 20, ink);
  right(page, text, d.issuedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), 9, A4.w - M, y - 34, muted);

  y = Math.min(ly, y - 50) - 18;
  page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.8, color: line });
  y -= 22;

  // Who it is for.
  page.drawText(d.kind === 'INVOICE' ? 'BILLED TO' : 'RECEIVED FROM', { x: M, y, size: 7.5, font: bold, color: muted });
  y -= 14;
  page.drawText(safe(d.recipient.name), { x: M, y, size: 11, font: bold, color: ink });
  y -= 13;
  for (const l of [d.recipient.email, d.recipient.phone].filter((v): v is string => Boolean(v))) {
    page.drawText(safe(l), { x: M, y, size: 9, font: text, color: muted });
    y -= 12;
  }
  y -= 10;

  // Lines.
  const colAmount = A4.w - M;
  page.drawRectangle({ x: M, y: y - 6, width: A4.w - 2 * M, height: 20, color: rgb(0.96, 0.96, 0.97) });
  page.drawText('DESCRIPTION', { x: M + 8, y, size: 7.5, font: bold, color: muted });
  right(page, bold, 'AMOUNT', 7.5, colAmount - 8, y, muted);
  y -= 24;
  for (const l of d.lines) {
    const rows = wrap(text, safe(l.title), 10, A4.w - 2 * M - 140);
    for (const [i, r] of rows.entries()) {
      page.drawText(r, { x: M + 8, y, size: 10, font: text, color: ink });
      if (i === 0) right(page, text, moneyText(l.amountPaise, d.currency), 10, colAmount - 8, y, ink);
      y -= 13;
    }
    if (l.detail) {
      page.drawText(safe(l.detail), { x: M + 8, y, size: 8.5, font: text, color: muted });
      y -= 12;
    }
    y -= 4;
  }
  page.drawLine({ start: { x: M, y: y + 2 }, end: { x: A4.w - M, y: y + 2 }, thickness: 0.6, color: line });
  y -= 14;

  // Totals, right-aligned block.
  for (const t of d.totals) {
    const f = t.strong ? bold : text;
    const size = t.strong ? 11.5 : 10;
    right(page, f, safe(t.label), size, colAmount - 130, y, t.strong ? ink : muted);
    right(page, f, moneyText(t.amountPaise, d.currency), size, colAmount - 8, y, ink);
    y -= t.strong ? 18 : 14;
  }
  y -= 8;

  if (d.paidBy || d.reference) {
    page.drawText(safe([d.paidBy ? `Paid by ${d.paidBy}` : '', d.reference ? `Ref ${d.reference}` : ''].filter(Boolean).join(' · ')), { x: M, y, size: 9, font: text, color: muted });
    y -= 14;
  }
  if (d.note) {
    for (const w of wrap(text, safe(d.note), 9, A4.w - 2 * M)) {
      page.drawText(w, { x: M, y, size: 9, font: text, color: muted });
      y -= 12;
    }
  }

  const foot = d.kind === 'INVOICE' ? 'This is a computer-generated invoice and needs no signature.' : 'This is a computer-generated receipt and needs no signature.';
  page.drawText(foot, { x: M, y: M - 10, size: 8, font: text, color: muted });

  return pdf.save();
}

function right(page: PDFPage, font: PDFFont, s: string, size: number, rightX: number, y: number, color: ReturnType<typeof rgb>) {
  page.drawText(s, { x: rightX - font.widthOfTextAtSize(s, size), y, size, font, color });
}

function hex(h: string) {
  const ok = /^#[0-9a-fA-F]{6}$/.test(h) ? h : '#322046';
  return rgb(parseInt(ok.slice(1, 3), 16) / 255, parseInt(ok.slice(3, 5), 16) / 255, parseInt(ok.slice(5, 7), 16) / 255);
}
