import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { permissionFor, reportById } from '@/lib/reports';
import { rangeFrom } from '../../../data';
import { toCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';

/**
 * The same rows as the page, as a file.
 *
 * One route for every report, so an export cannot fall out of step with what
 * the screen shows: both call the same function. This is also the migration
 * path out of here, which is a thing worth being able to say honestly.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const report = reportById(id);
  if (!report) return new NextResponse('Not found', { status: 404 });

  const tenant = await requireTenant();

  let staff;
  try {
    staff = await requireStaff(permissionFor(report), 'view');
  } catch {
    return new NextResponse('Not allowed', { status: 403 });
  }
  if (staff.organizationId !== tenant.organizationId) {
    return new NextResponse('Not allowed', { status: 403 });
  }

  const rangeParam = new URL(request.url).searchParams.get('range') ?? undefined;
  const { since, days, label } = rangeFrom(rangeParam);

  const result = await report.run({
    organizationId: tenant.organizationId,
    tenantId: tenant.tenantId,
    currency: tenant.currency,
    timeZone: tenant.timezone,
    since,
    days,
  });

  // The file carries what it is and what it counts, because a CSV opened three
  // weeks later on somebody else's laptop has no page around it to explain it.
  const preamble: (string | number | null)[][] = [
    [report.title],
    [report.question],
    [report.ignoresRange ? 'Covers: everything' : `Covers: ${label}`],
    [`Generated: ${new Date().toISOString()}`],
    [],
    ...report.definitions.map(([term, meaning]) => [`${term}:`, meaning]),
    [],
  ];

  const csv = toCsv([
    ...preamble,
    result.columns.map((c) => c.label),
    ...result.rows,
  ]);

  await recordAudit({
    organizationId: tenant.organizationId,
    actorId: staff.id,
    action: 'report.exported',
    entity: 'Report',
    entityId: report.id,
    after: { rows: result.rows.length, range: rangeParam ?? 'default' },
  });

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report.id}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
