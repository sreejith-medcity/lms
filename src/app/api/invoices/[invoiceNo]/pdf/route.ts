import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { mayViewMoneyDocument } from '@/lib/money-documents';
import { moneyPdf } from '@/lib/money-pdf-serve';

export const dynamic = 'force-dynamic';

/** The learner's own copy, or a staff download. A guessed number gets a 404, never a 403. */
export async function GET(_req: Request, { params }: { params: Promise<{ invoiceNo: string }> }) {
  const { invoiceNo } = await params;
  const tenant = await getTenantContext();
  const user = await getSessionUser();
  if (!tenant || !user || user.organizationId !== tenant.organizationId) return new NextResponse('Sign in', { status: 401 });
  const pdf = await moneyPdf(tenant.organizationId, 'INVOICE', decodeURIComponent(invoiceNo));
  if (!pdf || !mayViewMoneyDocument(user, pdf.doc.ownerId)) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${pdf.fileName}"`, 'cache-control': 'private, no-store' },
  });
}
