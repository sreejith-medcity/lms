import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getTenantContext } from '@/lib/tenant';
import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { dayKey } from '@/lib/clock';
import { monthWindow } from '@/lib/payouts';
import { tutorHours } from '@/lib/tutoring/data';

export const dynamic = 'force-dynamic';

/**
 * Online tutors' class hours for a month, for the payroll system to fetch.
 *
 *   GET /api/hrms/tutor-hours?month=2026-10
 *   Authorization: Bearer <the key on the HRMS card>
 *
 * Read only. Each tutor comes with their employee code (set under Online
 * tutors, Courses and tutors), email and phone to match on, the classes
 * held, the minutes, the hours to two places, a line per day, and how many
 * classes passed without a register (those add nothing until confirmed).
 * The month is the academy's calendar month; without one, the current month.
 */
export async function GET(request: Request) {
  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ error: 'Unknown academy.' }, { status: 404 });
  const hrms = await resolveIntegration(tenant.organizationId, 'hrms');
  const key = (hrms?.values.apiKey ?? '').trim();
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  /* Hashed first, so the comparison takes the same time whatever the lengths. */
  const same = key.length >= 16 && given.length > 0 && timingSafeEqual(createHash('sha256').update(key).digest(), createHash('sha256').update(given).digest());
  if (!same) return NextResponse.json({ error: key ? 'Not authorised.' : 'No HRMS key is set on this academy.' }, { status: 401, headers: { 'cache-control': 'no-store' } });

  const asked = new URL(request.url).searchParams.get('month') ?? '';
  const month = /^\d{4}-\d{2}$/.test(asked) ? asked : dayKey(new Date(), tenant.timezone).slice(0, 7);
  const window = monthWindow(month, tenant.timezone);
  if (!window) return NextResponse.json({ error: 'month is YYYY-MM.' }, { status: 400 });
  const rows = await tutorHours(tenant.organizationId, window.from, window.to, tenant.timezone);
  await recordIntegrationEvent({ organizationId: tenant.organizationId, provider: 'hrms', direction: 'OUT', action: `tutor hours ${month}`, ok: true, records: rows.length, detail: `${rows.reduce((n, r) => n + r.classes, 0)} classes` }).catch(() => undefined);
  return NextResponse.json(
    {
      month,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      timezone: tenant.timezone,
      generatedAt: new Date().toISOString(),
      tutors: rows.map((r) => ({
        id: r.userId,
        employeeCode: r.employeeCode,
        name: r.name,
        email: r.email,
        phone: r.phone,
        classes: r.classes,
        minutes: r.minutes,
        hours: r.hours,
        unconfirmedClasses: r.unconfirmed,
        days: r.days,
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
