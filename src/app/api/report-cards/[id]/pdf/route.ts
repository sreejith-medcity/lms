import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { reportCardPdf } from '@/lib/report-card-serve';
import { childOf, getParentSession } from '@/lib/parent-session';

export const dynamic = 'force-dynamic';

/** The learner's own, staff, or a parent signed in on the child's record. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getTenantContext();
  if (!tenant) return new NextResponse('Sign in', { status: 401 });
  const [user, parent] = await Promise.all([getSessionUser(), getParentSession()]);
  if ((!user || user.organizationId !== tenant.organizationId) && !parent) return new NextResponse('Sign in', { status: 401 });
  const pdf = await reportCardPdf(tenant.organizationId, id);
  if (!pdf) return new NextResponse('Not found', { status: 404 });
  const allowed =
    (user && (pdf.userId === user.id || user.kind === 'STAFF')) ||
    (parent && (await childOf(tenant.organizationId, parent.contact, pdf.userId)) !== null);
  if (!allowed) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${pdf.fileName}"`, 'cache-control': 'private, no-store' },
  });
}
