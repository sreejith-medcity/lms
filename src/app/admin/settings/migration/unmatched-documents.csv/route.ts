import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { toCsv } from '@/lib/csv';
import { unmatchedDocumentList } from '@/lib/migrate-edmingle';

export const dynamic = 'force-dynamic';

/** The lessons whose file Edmingle's asset library does not have: what to ask Edmingle about, or accept. */
export async function GET() {
  const tenant = await requireTenant();
  let staff;
  try {
    staff = await requireStaff('settings.integrations', 'view');
  } catch {
    return new NextResponse('Not allowed', { status: 403 });
  }
  if (staff.organizationId !== tenant.organizationId) return new NextResponse('Not allowed', { status: 403 });

  const rows = await unmatchedDocumentList();
  const csv = toCsv([['lesson', 'file_name', 'reason'], ...rows.map((r) => [r.name, r.fileName, r.reason])]);
  return new NextResponse(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="edmingle-documents-unmatched.csv"' },
  });
}
