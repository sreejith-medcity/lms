'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { queueNotifications, describeQueue } from '@/lib/notify';
import type { ActionState } from '@/server/courses';

/**
 * What the office does about an abandoned cart.
 *
 * The recording of carts lives in `src/lib/cart.ts`; only the two things a
 * person presses are actions here.
 */

/* The recovery list --------------------------------------------------------- */

async function guard(action: 'view' | 'edit' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('sales.abandoned_cart', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[cart]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function nudgeCarts(cartIds: string[]): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const ids = cartIds.filter(Boolean).slice(0, 200);
    if (ids.length === 0) return { error: 'Nothing was selected.' };

    const carts = await db.cart.findMany({
      where: {
        id: { in: ids },
        organizationId: tenant.organizationId,
        status: 'ABANDONED',
        userId: { not: null },
      },
      select: { id: true, user: { select: { id: true, email: true, phone: true } } },
    });
    if (carts.length === 0) return { error: 'None of those are still abandoned.' };

    const seen = new Set<string>();
    const recipients = carts
      .map((c) => c.user)
      .filter((u): u is { id: string; email: string | null; phone: string | null } => Boolean(u))
      .filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)))
      .map((u) => ({ userId: u.id, email: u.email, phone: u.phone }));

    const result = await queueNotifications({
      organizationId: tenant.organizationId,
      eventKey: 'cart.abandoned',
      recipients,
      dedupeKey: 'cart-nudge',
    });

    revalidatePath('/admin/carts');
    return { ok: true, message: describeQueue(result, 'nudge') };
  } catch (err) {
    return fail(err);
  }
}

/** Takes a cart off the list without pretending it was bought. */
export async function dismissCart(cartId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const cart = await db.cart.findFirst({
      where: { id: cartId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!cart) return { error: 'Cart not found.' };

    await db.cart.update({ where: { id: cartId }, data: { status: 'EXPIRED' } });

    revalidatePath('/admin/carts');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
