import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { can } from '@/lib/permissions';
import { readUrlFor } from '@/lib/storage';
import { redirectResponse } from '@/lib/http-headers';

export const dynamic = 'force-dynamic';

/** A candidate's own recording, for them on the result page and for the staff who mark it. */
export async function GET(_: Request, { params }: { params: Promise<{ sittingId: string; task: string }> }) {
  const { sittingId, task } = await params;
  const tenant = await getTenantContext();
  const user = await getSessionUser();
  if (!tenant || !user) return new NextResponse('Not found', { status: 404 });
  const sitting = await db.examSitting.findFirst({ where: { id: sittingId, organizationId: tenant.organizationId }, select: { userId: true } });
  if (!sitting) return new NextResponse('Not found', { status: 404 });
  const staff = user.kind === 'STAFF' && can(user.permissions, 'submission.view_submissions', 'view');
  if (sitting.userId !== user.id && !staff) return new NextResponse('Not found', { status: 404 });
  const sub = await db.examSubmission.findFirst({
    where: { organizationId: tenant.organizationId, sittingId, task },
    select: { recording: { select: { storageKey: true, mimeType: true } } },
  });
  if (!sub?.recording) return new NextResponse('Not found', { status: 404 });
  return redirectResponse(readUrlFor(sub.recording.storageKey, { mimeType: sub.recording.mimeType, expiresIn: 600 }), { headers: { 'Cache-Control': 'private, no-store' } });
}
