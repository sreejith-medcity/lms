import { bearerUser } from '@/lib/api/auth';
import { fail, ok } from '@/lib/api/http';
import { agendaFor } from '@/lib/agenda-data';
import { addDays, dayEnd, dayStart, todayKey } from '@/lib/clock';

export const dynamic = 'force-dynamic';

/** GET ?from=YYYY-MM-DD&days=7 → classes, due dates and test windows, on the academy's days. */
export async function GET(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const q = new URL(request.url).searchParams;
  const tz = ctx.tenant.timezone;
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(q.get('from') ?? '') ? (q.get('from') as string) : todayKey(tz);
  const days = Math.max(1, Math.min(31, Number(q.get('days') ?? 7) || 7));
  const items = await agendaFor({ organizationId: ctx.tenant.organizationId, userId: ctx.user.id, from: dayStart(fromKey, tz), to: dayEnd(addDays(fromKey, days - 1), tz), timeZone: tz });
  return ok({
    from: fromKey,
    days,
    timezone: tz,
    items: items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, detail: i.detail, startsAt: i.startsAt.toISOString(), endsAt: i.endsAt.toISOString(), allDay: i.allDay, day: i.day, webPath: i.url, canJoin: Boolean(i.joinUrl), status: i.status })),
  });
}
