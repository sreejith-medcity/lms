import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { certificatePdfFor } from '@/lib/certificate-issue';

export const dynamic = 'force-dynamic';

/** The holder's own copy, or a staff download. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getTenantContext();
  const user = await getSessionUser();
  if (!tenant || !user || user.organizationId !== tenant.organizationId) return new NextResponse('Sign in', { status: 401 });

  const cert = await db.issuedCertificate.findFirst({
    where: { id, template: { organizationId: tenant.organizationId } },
    select: { userId: true },
  });
  if (!cert) return new NextResponse('Not found', { status: 404 });
  if (cert.userId !== user.id && user.kind !== 'STAFF') return new NextResponse('Not found', { status: 404 });

  const pdf = await certificatePdfFor(id, tenant.organizationId);
  if (!pdf) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${pdf.fileName}"`, 'cache-control': 'private, no-store' },
  });
}
