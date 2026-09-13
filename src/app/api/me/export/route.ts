import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { getSessionUser } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { buildDataExport } from '@/lib/data-export';
import { exportFileName, exportRateProblem } from '@/lib/data-rights';

export const dynamic = 'force-dynamic';

/**
 * "Give me a copy of my data": one JSON file, made on the spot for the
 * signed-in learner and nobody else. Each copy is recorded as a DONE
 * request, so the office can see it was taken and the learner can see it
 * in the file itself.
 */
export async function GET() {
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (!tenant || !user) return new NextResponse('Please sign in.', { status: 401 });

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const today = await db.dataRequest.count({
    where: { userId: user.id, organizationId: tenant.organizationId, kind: 'EXPORT', createdAt: { gte: since } },
  });
  const problem = exportRateProblem(today);
  if (problem) return new NextResponse(problem, { status: 429 });

  const data = await buildDataExport(tenant.organizationId, user.id);
  if (!data) return new NextResponse('Not found.', { status: 404 });

  await db.dataRequest.create({
    data: { organizationId: tenant.organizationId, userId: user.id, kind: 'EXPORT', status: 'DONE', handledAt: new Date() },
  });
  await recordAudit({
    organizationId: tenant.organizationId,
    actorId: user.id,
    action: 'data_request.exported',
    entity: 'User',
    entityId: user.id,
  });

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFileName(data.academy, new Date())}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
