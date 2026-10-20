'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { cancelFree, registerFree } from '@/lib/event-tickets';
import { startCheckout } from '@/server/checkout';

export type RegisterResult =
  | { ok: true; message: string; checkoutUrl?: string }
  | { ok: false; error: string; signIn?: true };

/** The button on an event page: a free place now, or checkout for a ticket. */
export async function registerForEvent(productId: string): Promise<RegisterResult> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Please sign in to register.', signIn: true };

    const product = await db.product.findFirst({
      where: { id: productId, organizationId: tenant.organizationId, type: 'EVENT', status: 'PUBLISHED', deletedAt: null },
      select: { slug: true, pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: 1, select: { id: true, pricePaise: true } } },
    });
    if (!product) return { ok: false, error: 'This event is not open for registration.' };

    const plan = product.pricingPlans[0];
    if (plan && plan.pricePaise > 0) {
      const started = await startCheckout(productId, plan.id);
      if (!started.ok) return started;
      return { ok: true, message: 'Taking you to payment.', checkoutUrl: `/checkout/${started.orderId}` };
    }

    const done = await registerFree(tenant.organizationId, user.id, productId);
    revalidatePath(`/event/${product.slug}`);
    return done.ok ? { ok: true, message: done.message } : done;
  } catch (err) {
    console.error('[events]', err instanceof Error ? err.message : err);
    return { ok: false, error: 'Could not register you just now. Please try again.' };
  }
}

export async function giveUpEventPlace(productId: string): Promise<RegisterResult> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { ok: false, error: 'Please sign in first.', signIn: true };
    const done = await cancelFree(tenant.organizationId, user.id, productId);
    revalidatePath('/events');
    return done.ok ? { ok: true, message: done.message } : done;
  } catch (err) {
    console.error('[events]', err instanceof Error ? err.message : err);
    return { ok: false, error: 'Could not do that just now. Please try again.' };
  }
}
