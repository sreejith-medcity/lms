import { db } from '@/lib/db';
import { getObject } from '@/lib/storage';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { invoiceDocument, receiptDocument, type MoneyDocumentData } from '@/lib/money-documents';
import { renderMoneyPdf } from '@/lib/money-pdf';

/**
 * A receipt or invoice PDF with the academy's mark on it, for the routes
 * and for the email attachment. Not kept: these render in a few
 * milliseconds and never change.
 */
export async function moneyPdf(organizationId: string, kind: 'INVOICE' | 'RECEIPT', number: string): Promise<{ bytes: Uint8Array; fileName: string; doc: MoneyDocumentData } | null> {
  const doc = kind === 'INVOICE' ? await invoiceDocument(organizationId, number) : await receiptDocument(organizationId, number);
  if (!doc) return null;
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { brandColor: true, logoUrl: true } });
  const logo = await logoBytes(organizationId, org?.logoUrl ?? null);
  const bytes = await renderMoneyPdf({ doc, accentHex: org?.brandColor, logo });
  return { bytes, fileName: `${doc.kind === 'INVOICE' ? 'invoice' : 'receipt'}-${doc.number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`, doc };
}

async function logoBytes(organizationId: string, logoUrl: string | null) {
  if (!logoUrl) return null;
  const m = /^\/api\/assets\/([A-Za-z0-9_-]+)/.exec(logoUrl);
  if (m) {
    const asset = await db.asset.findFirst({ where: { id: m[1], organizationId, deletedAt: null }, select: { storageKey: true, mimeType: true } });
    if (!asset) return null;
    const bytes = await getObject(asset.storageKey, 4 * 1024 * 1024);
    return bytes ? { bytes, mimeType: asset.mimeType } : null;
  }
  if (logoUrl.startsWith('/brand/')) {
    try {
      return { bytes: new Uint8Array(await readFile(join(process.cwd(), 'public', logoUrl === '/brand/logo.png' ? '/brand/mark.png' : logoUrl))), mimeType: 'image/png' };
    } catch {
      return null;
    }
  }
  return null;
}
