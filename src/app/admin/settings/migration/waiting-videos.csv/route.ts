import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { toCsv } from '@/lib/csv';
import { waitingVideoList } from '@/lib/migrate-edmingle';

export const dynamic = 'force-dynamic';

/** The video files the imported lessons are waiting for: the list to send with the export request. */
export async function GET() {
  const tenant = await requireTenant();
  let staff;
  try {
    staff = await requireStaff('settings.integrations', 'view');
  } catch {
    return new NextResponse('Not allowed', { status: 403 });
  }
  if (staff.organizationId !== tenant.organizationId) return new NextResponse('Not allowed', { status: 403 });

  const rows = await waitingVideoList();
  const csv = toCsv([['lesson', 'file_name', 'vimeo_id'], ...rows.map((r) => [r.name, r.fileName, r.vimeoId])]);
  return new NextResponse(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="edmingle-videos-waiting.csv"' },
  });
}
