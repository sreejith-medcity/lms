import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { permissionFor, reportById } from '@/lib/reports';

export const dynamic = 'force-dynamic';

/** The file a scheduled report sent, as it was sent. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const tenant = await requireTenant();
  const run = await db.reportRun.findFirst({
    where: { id: runId, organizationId: tenant.organizationId },
    select: { reportId: true, fileName: true, csv: true },
  });
  if (!run) return new NextResponse('Not found', { status: 404 });

  const report = reportById(run.reportId);
  try {
    await requireStaff(report ? permissionFor(report) : 'reports.sales_reports', 'view');
  } catch {
    return new NextResponse('Not allowed', { status: 403 });
  }

  return new NextResponse(run.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${run.fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
