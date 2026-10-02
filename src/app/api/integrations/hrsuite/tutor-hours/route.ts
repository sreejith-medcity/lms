import { NextResponse } from 'next/server';
import { getTenantContext } from '@/lib/tenant';
import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { dayKey } from '@/lib/clock';
import { monthWindow } from '@/lib/payouts';
import { bearerMatches } from '@/lib/hrsuite-feed';
import { tutorHours } from '@/lib/tutoring/data';

export const dynamic = 'force-dynamic';

/**
 * Online tutors' class hours for a month, as this site counts them.
 *
 *   GET /api/integrations/hrsuite/tutor-hours?month=2026-10
 *   Authorization: Bearer <the shared secret set under Integrations, HRSuite>
 *
 * HRSuite pays from the classes feed next door (../classes); this is the
 * same month added up here, the figures on Online tutors, Hours, so a
 * payslip can be checked against them. Read only. Each tutor comes with
 * their employee code (set under Online tutors, Courses and tutors), email
 * and phone to match on, the classes held, the minutes, the hours to two
 * places, a line per day, and how many classes passed without a register
 * (those add nothing until confirmed). The month is the academy's calendar
 * month; without one, the current month.
 */
export async function GET(request: Request) {
  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ error: 'Unknown host.' }, { status: 404 });
  const resolved = await resolveIntegration(tenant.organizationId, 'hrsuite');
  const secret = resolved?.values.sharedSecret;
  if (!secret) return NextResponse.json({ error: 'HRSuite is not connected here.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    await recordIntegrationEvent({ organizationId: tenant.organizationId, provider: 'hrsuite', direction: 'IN', action: 'Tutor hours refused', ok: false, detail: 'Wrong or missing token.' }).catch(() => undefined);
    return NextResponse.json({ error: 'Wrong or missing token.' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }

  const asked = new URL(request.url).searchParams.get('month');
  if (asked && !/^\d{4}-\d{2}$/.test(asked)) return NextResponse.json({ error: 'month is YYYY-MM.' }, { status: 400 });
  const month = asked ?? dayKey(new Date(), tenant.timezone).slice(0, 7);
  const window = monthWindow(month, tenant.timezone);
  if (!window) return NextResponse.json({ error: 'month is YYYY-MM.' }, { status: 400 });
  const rows = await tutorHours(tenant.organizationId, window.from, window.to, tenant.timezone);
  await recordIntegrationEvent({
    organizationId: tenant.organizationId,
    provider: 'hrsuite',
    direction: 'OUT',
    action: `Tutor hours read, ${month}`,
    ok: true,
    records: rows.length,
    detail: `${rows.reduce((n, r) => n + r.classes, 0)} classes`,
  }).catch(() => undefined);
  return NextResponse.json(
    {
      ok: true,
      month,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      timezone: tenant.timezone,
      generatedAt: new Date().toISOString(),
      tutors: rows.map((r) => ({
        userId: r.userId,
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
