import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { toCsv } from '@/lib/csv';
import { dayKey } from '@/lib/clock';
import { monthWindow } from '@/lib/payouts';
import { tutorHours } from '@/lib/tutoring/data';

export const dynamic = 'force-dynamic';

/** A month of online class hours per tutor, for payroll to keep or import by hand. */
export async function GET(request: Request) {
  const tenant = await requireTenant();
  let staff;
  try {
    staff = await requireStaff('scheduling.sessions', 'view');
  } catch {
    return new NextResponse('Not allowed', { status: 403 });
  }
  if (staff.organizationId !== tenant.organizationId) return new NextResponse('Not allowed', { status: 403 });
  const asked = new URL(request.url).searchParams.get('month') ?? '';
  const key = /^\d{4}-\d{2}$/.test(asked) ? asked : dayKey(new Date(), tenant.timezone).slice(0, 7);
  const window = monthWindow(key, tenant.timezone);
  if (!window) return new NextResponse('Pick a month', { status: 400 });
  const rows = await tutorHours(tenant.organizationId, window.from, window.to, tenant.timezone);
  const csv = toCsv([
    ['month', 'employee_code', 'tutor', 'email', 'phone', 'classes_held', 'minutes', 'hours', 'classes_not_confirmed'],
    ...rows.map((r) => [key, r.employeeCode ?? '', r.name, r.email ?? '', r.phone ?? '', r.classes, r.minutes, r.hours, r.unconfirmed]),
  ]);
  return new NextResponse(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="online-tutor-hours-${key}.csv"` } });
}
