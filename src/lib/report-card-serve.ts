import { db } from '@/lib/db';
import { readReportCard } from '@/lib/report-card';
import { renderReportCardPdf } from '@/lib/report-card-pdf';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { getObject } from '@/lib/storage';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One report card as a PDF, from its snapshot. */
export async function reportCardPdf(organizationId: string, id: string): Promise<{ bytes: Uint8Array; fileName: string; userId: string } | null> {
  const card = await db.reportCard.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      userId: true,
      title: true,
      periodFrom: true,
      periodTo: true,
      remark: true,
      data: true,
      issuedAt: true,
      user: { select: { name: true } },
      enrollment: { select: { product: { select: { title: true } }, batch: { select: { name: true } } } },
    },
  });
  if (!card) return null;
  const data = readReportCard(card.data);
  if (!data) return null;
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, brandColor: true, logoUrl: true, timezone: true } });
  if (!org) return null;
  const day = (d: Date) => formatDayLabel(dayKey(d, org.timezone), org.timezone, true);
  const period = card.periodFrom || card.periodTo ? `${card.periodFrom ? day(card.periodFrom) : 'Start'} to ${card.periodTo ? day(card.periodTo) : day(card.issuedAt)}` : `Up to ${day(card.issuedAt)}`;
  const bytes = await renderReportCardPdf({
    academy: org.name,
    learner: card.user.name,
    course: card.enrollment.product.title,
    batch: card.enrollment.batch?.name ?? null,
    title: card.title,
    period,
    issuedOn: day(card.issuedAt),
    remark: card.remark,
    data,
    accentHex: org.brandColor,
    logo: await logoBytes(organizationId, org.logoUrl),
  });
  return { bytes, fileName: `report-card-${card.user.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${card.id.slice(-6)}.pdf`, userId: card.userId };
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
