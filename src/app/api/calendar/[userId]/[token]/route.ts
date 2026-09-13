import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { calendarTokenMatches, toIcs } from '@/lib/agenda';
import { agendaFor } from '@/lib/agenda-data';
import { organizationOrigin } from '@/lib/org-origin';

export const dynamic = 'force-dynamic';

/**
 * The learner's iCal feed. No sign-in, because phone calendars cannot
 * sign in: the token in the address is the whole secret, derived from the
 * learner's id under the application secret and checked in constant time.
 * Thirty days back and ninety ahead, refreshed by the calendar app itself.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string; token: string }> }) {
  const { userId, token: raw } = await params;
  const token = raw.replace(/\.ics$/i, '');
  const tenant = await getTenantContext();
  if (!tenant) return new NextResponse('Not found', { status: 404 });
  if (!calendarTokenMatches(userId, token, process.env.AUTH_SECRET || 'insecure-development-secret')) return new NextResponse('Not found', { status: 404 });

  const [user, org] = await Promise.all([
    db.user.findFirst({ where: { id: userId, organizationId: tenant.organizationId, deletedAt: null }, select: { id: true } }),
    db.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true, timezone: true } }),
  ]);
  if (!user || !org) return new NextResponse('Not found', { status: 404 });

  const now = Date.now();
  const items = await agendaFor({ organizationId: tenant.organizationId, userId: user.id, from: new Date(now - 30 * 86_400_000), to: new Date(now + 90 * 86_400_000), timeZone: org.timezone });
  const origin = await organizationOrigin(tenant.organizationId);
  const ics = toIcs({ name: `${org.name} classes`, items, origin, timeZone: org.timezone });
  return new NextResponse(ics, {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'inline; filename="classes.ics"', 'cache-control': 'private, max-age=900' },
  });
}
