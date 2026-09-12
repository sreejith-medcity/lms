import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { certificatePdfFor } from '@/lib/certificate-issue';

export const dynamic = 'force-dynamic';

/**
 * The PDF behind the public verify page. The token is the whole secret,
 * the same as the page: whoever has the code on the paper may have the
 * paper. Scoped to the academy's own hostname like the page is.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const site = await getSiteContext();
  if (!site) return new NextResponse('Not found', { status: 404 });
  const cert = await db.issuedCertificate.findFirst({
    where: { verifyToken: token, template: { organizationId: site.organizationId } },
    select: { id: true },
  });
  if (!cert) return new NextResponse('Not found', { status: 404 });
  const pdf = await certificatePdfFor(cert.id, site.organizationId);
  if (!pdf) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${pdf.fileName}"`, 'cache-control': 'private, no-store' },
  });
}
