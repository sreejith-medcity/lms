import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentHost, requireStaff } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { logoPicture } from '@/lib/certificate-issue';
import { renderQrSheet } from '@/lib/qr-sheet';
import { posterTarget } from '@/lib/qr-targets';

export const dynamic = 'force-dynamic';

/**
 * One QR code in the academy's colours, as a poster or as a sheet of
 * labels: the sign-up page for a notice board, the enquiry form for a
 * window, a course page for a leaflet, or any address on the academy's
 * own site.
 */
export async function GET(request: Request) {
  const tenant = await getTenantContext();
  if (!tenant) return new NextResponse('Not found', { status: 404 });
  try {
    await requireStaff('blogs.manage_blogs', 'view');
  } catch {
    return new NextResponse('Sign in', { status: 401 });
  }
  const sp = new URL(request.url).searchParams;
  const host = await currentHost();
  const target = posterTarget(host, { to: sp.get('to') ?? '', path: sp.get('path') ?? '', heading: sp.get('heading') ?? '', line: sp.get('line') ?? '' });
  if (!target) return new NextResponse('That address is not on this site.', { status: 400 });
  const layout = sp.get('layout') === 'labels' ? 'labels' : 'poster';
  const copies = layout === 'labels' ? Math.min(Math.max(Number(sp.get('copies')) || 8, 1), 40) : 1;

  const org = await db.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true, logoUrl: true, brandColor: true } });
  if (!org) return new NextResponse('Not found', { status: 404 });
  const logo = await logoPicture(tenant.organizationId, org.logoUrl);
  const item = { url: target.url, heading: target.heading, code: null, lines: target.line ? [target.line] : [] };
  const bytes = await renderQrSheet({
    academy: org.name,
    accentHex: org.brandColor,
    logo,
    layout,
    footer: layout === 'labels' ? target.url.replace(/^https?:\/\//, '') : null,
    items: Array.from({ length: copies }, () => item),
  });
  return new NextResponse(Buffer.from(bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="qr-${target.slug}.pdf"`, 'cache-control': 'no-store' } });
}
