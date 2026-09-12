import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { reportCardPdf } from '@/lib/report-card-serve';

export const dynamic = 'force-dynamic';

/** The learner's own, or staff. A parent opens the copy attached to their email. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getTenantContext();
  const user = await getSessionUser();
  if (!tenant || !user || user.organizationId !== tenant.organizationId) return new NextResponse('Sign in', { status: 401 });
  const pdf = await reportCardPdf(tenant.organizationId, id);
  if (!pdf || (pdf.userId !== user.id && user.kind !== 'STAFF')) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${pdf.fileName}"`, 'cache-control': 'private, no-store' },
  });
}
