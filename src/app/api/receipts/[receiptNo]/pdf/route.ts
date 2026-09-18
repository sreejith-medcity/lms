import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { getParentSession } from '@/lib/parent-session';
import { mayViewMoneyDocument } from '@/lib/money-documents';
import { moneyPdf } from '@/lib/money-pdf-serve';

export const dynamic = 'force-dynamic';

/**
 * The learner's own copy, a staff download, or a linked parent's copy for
 * their child. A guessed number gets a 404, never a 403.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ receiptNo: string }> }) {
  const { receiptNo } = await params;
  const tenant = await getTenantContext();
  if (!tenant) return new NextResponse('Sign in', { status: 401 });
  const user = await getSessionUser();
  const parent = user ? null : await getParentSession();
  if ((!user || user.organizationId !== tenant.organizationId) && (!parent || parent.organizationId !== tenant.organizationId)) return new NextResponse('Sign in', { status: 401 });
  const pdf = await moneyPdf(tenant.organizationId, 'RECEIPT', decodeURIComponent(receiptNo));
  if (!pdf) return new NextResponse('Not found', { status: 404 });
  let allowed = user ? mayViewMoneyDocument(user, pdf.doc.ownerId) : false;
  if (!allowed && parent && pdf.doc.ownerId) {
    // The receipt's owner must be a child this contact is linked to, today.
    const link = await db.parentLink.count({ where: { organizationId: tenant.organizationId, contact: parent.contact, learnerId: pdf.doc.ownerId, status: 'ACTIVE' } });
    allowed = link > 0;
  }
  if (!allowed) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${pdf.fileName}"`, 'cache-control': 'private, no-store' },
  });
}
