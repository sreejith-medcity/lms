'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import type { ActionState } from '@/server/courses';

/**
 * Attaching one product to another as a tick box.
 *
 * The interesting work here is refusal. An add-on that points at its own
 * parent, or at something in another academy's catalogue, or at a product
 * that is itself only sold as an add-on, would each produce a storefront that
 * cannot be reasoned about, so none of them are allowed to be saved.
 */

async function guard() {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('courses.course_management', 'edit'),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[addons]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const attach = z.object({
  productId: z.string().min(1),
  addonProductId: z.string().min(1),
  label: z.string().trim().max(80).optional().or(z.literal('')),
  note: z.string().trim().max(160).optional().or(z.literal('')),
  isPreselected: z.boolean(),
});

export async function attachAddon(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const parsed = attach.safeParse({
      productId: formData.get('productId'),
      addonProductId: formData.get('addonProductId'),
      label: formData.get('label') || '',
      note: formData.get('note') || '',
      isPreselected: formData.get('isPreselected') === 'on',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    if (d.productId === d.addonProductId) {
      return { error: 'A course cannot be an add-on of itself.' };
    }

    // Both ends are looked up inside this organisation. A product id from
    // another academy simply does not resolve, which is the check.
    const [parent, addon] = await Promise.all([
      db.product.findFirst({
        where: { id: d.productId, organizationId: tenant.organizationId, deletedAt: null },
        select: { id: true, title: true, isAddonOnly: true },
      }),
      db.product.findFirst({
        where: { id: d.addonProductId, organizationId: tenant.organizationId, deletedAt: null },
        select: {
          id: true,
          title: true,
          pricingPlans: { where: { isActive: true }, select: { pricePaise: true } },
        },
      }),
    ]);

    if (!parent) return { error: 'Course not found.' };
    if (!addon) return { error: 'That product is not in this catalogue.' };
    if (parent.isAddonOnly) {
      return { error: 'A product sold only as an add-on cannot carry add-ons of its own.' };
    }
    if (!addon.pricingPlans.some((p) => p.pricePaise > 0)) {
      return {
        error: `${addon.title} has no active priced plan, so a tick box for it would cost nothing.`,
      };
    }

    await db.productAddon.upsert({
      where: {
        productId_addonProductId: { productId: d.productId, addonProductId: d.addonProductId },
      },
      create: {
        organizationId: tenant.organizationId,
        productId: d.productId,
        addonProductId: d.addonProductId,
        label: d.label || null,
        note: d.note || null,
        isPreselected: d.isPreselected,
        isActive: true,
      },
      update: {
        label: d.label || null,
        note: d.note || null,
        isPreselected: d.isPreselected,
        isActive: true,
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'product.addon.attach',
      entity: 'Product',
      entityId: d.productId,
      after: { addonProductId: d.addonProductId, label: d.label || null },
    });

    revalidatePath(`/admin/courses/${d.productId}`);
    return { ok: true, message: `${addon.title} is now offered with ${parent.title}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function detachAddon(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const id = String(formData.get('id') ?? '');
    if (!id) return { error: 'Nothing to remove.' };

    // Scoped to the organisation on the way in, so an id from elsewhere
    // deletes nothing rather than deleting somebody else's row.
    const row = await db.productAddon.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, productId: true, addonProductId: true },
    });
    if (!row) return { error: 'That add-on is no longer attached.' };

    await db.productAddon.delete({ where: { id: row.id } });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'product.addon.detach',
      entity: 'Product',
      entityId: row.productId,
      before: { addonProductId: row.addonProductId },
    });

    revalidatePath(`/admin/courses/${row.productId}`);
    return { ok: true, message: 'Removed.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setAddonOnly(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const productId = String(formData.get('productId') ?? '');
    const on = formData.get('isAddonOnly') === 'on';

    const product = await db.product.findFirst({
      where: { id: productId, organizationId: tenant.organizationId },
      select: { id: true, isAddonOnly: true },
    });
    if (!product) return { error: 'Course not found.' };

    // Turning this on for something that itself carries add-ons would leave
    // those tick boxes on a page nobody can reach.
    if (on) {
      const carries = await db.productAddon.count({
        where: { organizationId: tenant.organizationId, productId },
      });
      if (carries > 0) {
        return { error: 'Remove the add-ons attached to this course before hiding it.' };
      }
    }

    await db.product.update({ where: { id: productId }, data: { isAddonOnly: on } });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'product.addonOnly',
      entity: 'Product',
      entityId: productId,
      before: { isAddonOnly: product.isAddonOnly },
      after: { isAddonOnly: on },
    });

    revalidatePath(`/admin/courses/${productId}`);
    revalidatePath('/courses');
    return {
      ok: true,
      message: on
        ? 'Hidden from the catalogue. It can now only be bought alongside a course.'
        : 'Back in the catalogue as a course of its own.',
    };
  } catch (err) {
    return fail(err);
  }
}
