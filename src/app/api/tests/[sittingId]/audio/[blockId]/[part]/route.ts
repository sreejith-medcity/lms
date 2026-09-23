import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { readUrlFor } from '@/lib/storage';
import { redirectResponse } from '@/lib/http-headers';
import { audioForPaper } from '@/lib/exams/content';
import { paperOf } from '@/lib/exams/sittings';

export const dynamic = 'force-dynamic';

/**
 * One listening file of a paper under way (or finished, for the review).
 * Only to the person sitting it or staff, and only files of blocks in
 * their paper. A listening text without its questions is only German being
 * spoken, but there is no reason to hand the library to anyone who asks.
 */
export async function GET(_: Request, { params }: { params: Promise<{ sittingId: string; blockId: string; part: string }> }) {
  const { sittingId, blockId, part } = await params;
  const tenant = await getTenantContext();
  const user = await getSessionUser();
  if (!tenant || !user) return new NextResponse('Not found', { status: 404 });
  const sitting = await db.examSitting.findFirst({ where: { id: sittingId, organizationId: tenant.organizationId }, select: { userId: true, formatCode: true, paper: true } });
  if (!sitting || (sitting.userId !== user.id && user.kind !== 'STAFF')) return new NextResponse('Not found', { status: 404 });
  const paper = paperOf(sitting).filter((p) => p.id === blockId);
  const files = await audioForPaper(tenant.organizationId, sitting.formatCode, paper);
  const assetId = files[blockId]?.[Number(part)];
  if (!assetId) return new NextResponse('Not found', { status: 404 });
  const asset = await db.asset.findFirst({ where: { id: assetId, organizationId: tenant.organizationId }, select: { storageKey: true, mimeType: true } });
  if (!asset) return new NextResponse('Not found', { status: 404 });
  return redirectResponse(readUrlFor(asset.storageKey, { mimeType: asset.mimeType, expiresIn: 3600 }), { headers: { 'Cache-Control': 'private, max-age=300' } });
}
