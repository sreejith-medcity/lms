import { bearerUser } from '@/lib/api/auth';
import { fail, ok } from '@/lib/api/http';
import { myEvents, upcomingEvents } from '@/lib/event-tickets';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/events
 *
 * `upcoming`: the academy's published events that have not finished, soonest
 * first. `mine`: the ones this person holds a place at. Each says whether
 * registering is possible (`closedReason` null), the places left, the price,
 * and for someone registered the join link from half an hour before an online
 * event (`joinUrl`, else `joinLater`). A paid ticket is bought on the event's
 * web page: open `/event/<slug>` through POST /api/v1/auth/web.
 */
export async function GET(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const [upcoming, mine] = await Promise.all([
    upcomingEvents(ctx.tenant.organizationId, ctx.user.id),
    myEvents(ctx.tenant.organizationId, ctx.user.id),
  ]);
  return ok({ upcoming, mine });
}
