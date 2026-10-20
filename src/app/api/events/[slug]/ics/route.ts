import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { organizationOrigin } from '@/lib/org-origin';
import { eventBySlug } from '@/lib/event-tickets';
import { eventIcs } from '@/lib/event-rules';

export const dynamic = 'force-dynamic';

/**
 * One event as a calendar file. Public, like the page it comes from: it
 * carries the time, the place and the page's address, never the join link,
 * which stays behind the page for people with a place.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenantContext();
  if (!tenant) return new NextResponse('Not found', { status: 404 });
  const event = await eventBySlug(tenant.organizationId, slug, null);
  if (!event?.startsAt) return new NextResponse('Not found', { status: 404 });

  const [org, origin] = await Promise.all([
    db.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true } }),
    organizationOrigin(tenant.organizationId),
  ]);
  const ics = eventIcs({
    uid: `event-${event.id}@${new URL(origin).host}`,
    title: event.title,
    startsAt: new Date(event.startsAt),
    endsAt: event.endsAt ? new Date(event.endsAt) : null,
    location: event.isOnline ? 'Online' : event.venue,
    url: `${origin}/event/${event.slug}`,
    organizer: org?.name ?? 'Academy',
  });
  return new NextResponse(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${event.slug}.ics"`,
      'cache-control': 'public, max-age=300',
    },
  });
}
