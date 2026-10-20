import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { bearerUser } from '@/lib/api/auth';
import { fail, ok } from '@/lib/api/http';
import { myEvents, registerFree } from '@/lib/event-tickets';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/events/:id/register
 *
 * A free place, taken at once (201, with `mine`). A paid event answers 409
 * `paid_event` with `path`, the web page to buy the ticket on.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { id } = await params;
  const product = await db.product.findFirst({
    where: { id, organizationId: ctx.tenant.organizationId, type: 'EVENT', status: 'PUBLISHED', deletedAt: null },
    select: { slug: true, pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: 1, select: { pricePaise: true } } },
  });
  if (!product) return fail('not_found', 'Event not found.', 404);
  if ((product.pricingPlans[0]?.pricePaise ?? 0) > 0) {
    return fail('paid_event', 'Tickets for this event are bought on its page.', 409, { path: `/event/${product.slug}` });
  }
  const r = await registerFree(ctx.tenant.organizationId, ctx.user.id, id);
  if (!r.ok) return fail('closed', r.error, 400);
  revalidatePath(`/event/${product.slug}`);
  return ok({ message: r.message, mine: await myEvents(ctx.tenant.organizationId, ctx.user.id) }, { status: 201 });
}
