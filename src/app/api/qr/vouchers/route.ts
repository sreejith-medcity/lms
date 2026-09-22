import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentHost, requireStaff } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { describeVoucher } from '@/lib/reward-rules';
import { logoPicture } from '@/lib/certificate-issue';
import { renderQrSheet } from '@/lib/qr-sheet';

export const dynamic = 'force-dynamic';

/**
 * A printed batch of vouchers as a sheet of QR labels, eight to a page.
 *
 * Only the ones nobody has claimed yet are printed, so a batch printed
 * again halfway through hands out no code that is already somebody's.
 * Each label carries the code as well, for the learner whose phone will
 * not scan.
 */
export async function GET(request: Request) {
  const tenant = await getTenantContext();
  if (!tenant) return new NextResponse('Not found', { status: 404 });
  try {
    await requireStaff('settings.preferences', 'view');
  } catch {
    return new NextResponse('Sign in', { status: 401 });
  }
  const batch = (new URL(request.url).searchParams.get('batch') ?? '').trim().slice(0, 80);
  if (!batch) return new NextResponse('Which batch?', { status: 400 });

  const [vouchers, org] = await Promise.all([
    db.voucher.findMany({
      where: { organizationId: tenant.organizationId, source: 'BATCH', batchLabel: batch, status: 'ISSUED', userId: null },
      orderBy: { code: 'asc' },
      select: { code: true, kind: true, value: true, maxDiscountPaise: true, expiresAt: true, productId: true },
    }),
    db.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true, logoUrl: true, brandColor: true } }),
  ]);
  if (!org) return new NextResponse('Not found', { status: 404 });

  const productIds = [...new Set(vouchers.map((v) => v.productId).filter((id): id is string => Boolean(id)))];
  const products = productIds.length ? await db.product.findMany({ where: { id: { in: productIds }, organizationId: tenant.organizationId }, select: { id: true, title: true } }) : [];
  const titleOf = (id: string | null) => (id ? (products.find((p) => p.id === id)?.title ?? 'one course') : null);
  const host = await currentHost();
  const logo = await logoPicture(tenant.organizationId, org.logoUrl);
  const bytes = await renderQrSheet({
    academy: org.name,
    accentHex: org.brandColor,
    logo,
    layout: 'labels',
    footer: `Scan to claim it, or type the code at ${host}/learn/rewards. Then use it in the code box at checkout.`,
    items: vouchers.map((v) => ({
      url: `https://${host}/learn/rewards?code=${encodeURIComponent(v.code)}`,
      heading: describeVoucher(v, tenant.currency),
      code: v.code,
      lines: [
        v.productId ? `On ${titleOf(v.productId)}.` : 'On any course.',
        v.expiresAt ? `Use it by ${v.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tenant.timezone })}.` : 'No expiry.',
        'Whoever claims it first keeps it.',
      ],
    })),
  });
  const name = `vouchers-${batch.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
  return new NextResponse(Buffer.from(bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'no-store' } });
}
