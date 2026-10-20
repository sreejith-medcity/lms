import { bearerUser } from '@/lib/api/auth';
import { fail, ok } from '@/lib/api/http';
import { cancelFree, myEvents } from '@/lib/event-tickets';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/events/:id/cancel
 *
 * Gives up a free place before the event starts. A paid place is cancelled
 * by the academy, which handles the refund.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { id } = await params;
  const r = await cancelFree(ctx.tenant.organizationId, ctx.user.id, id);
  if (!r.ok) return fail('invalid', r.error, 400);
  return ok({ message: r.message, mine: await myEvents(ctx.tenant.organizationId, ctx.user.id) });
}
