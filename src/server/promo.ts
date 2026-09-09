'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff, getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { toPaise } from '@/lib/money';
import { discountFor, normaliseCode, refusalMessage, type PromoRefusal } from '@/lib/promo';
import type { ActionState } from '@/server/courses';

/**
 * Promo codes.
 *
 * The interesting part is not the discount, which is arithmetic, but the
 * limits: a code stamped "first 50 only" that lets in 63 people is worse than
 * no code at all. Every count that gates a redemption is taken under a row lock
 * on the code itself, so two people pressing pay at the same second queue
 * rather than race.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('promocode.manage_promocodes', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[promo]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const promoShape = z.object({
  code: z.string().trim().min(3, 'A code needs at least three characters').max(32),
  description: z.string().trim().max(200).optional(),
  discountType: z.enum(['PERCENT', 'FLAT']),
  discountValue: z.coerce.number().min(0.01, 'Set a discount above zero'),
  maxDiscountRupees: z.coerce.number().min(0).optional(),
  minOrderRupees: z.coerce.number().min(0).optional(),
  usageType: z.enum(['SINGLE', 'MULTIPLE']),
  maxRedemptions: z.coerce.number().int().min(0).optional(),
  perUserLimit: z.coerce.number().int().min(1).max(50),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

export async function savePromoCode(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const id = String(formData.get('id') ?? '');
    const parsed = promoShape.safeParse({
      code: formData.get('code'),
      description: formData.get('description') || undefined,
      discountType: formData.get('discountType') || 'PERCENT',
      discountValue: formData.get('discountValue'),
      maxDiscountRupees: formData.get('maxDiscountRupees') || undefined,
      minOrderRupees: formData.get('minOrderRupees') || undefined,
      usageType: formData.get('usageType') || 'MULTIPLE',
      maxRedemptions: formData.get('maxRedemptions') || undefined,
      perUserLimit: formData.get('perUserLimit') || 1,
      startsAt: formData.get('startsAt') || undefined,
      endsAt: formData.get('endsAt') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const code = normaliseCode(d.code);

    if (d.discountType === 'PERCENT' && d.discountValue > 100) {
      return { error: 'A percentage discount cannot be more than 100.' };
    }

    const startsAt = d.startsAt ? new Date(d.startsAt) : null;
    const endsAt = d.endsAt ? new Date(`${d.endsAt}T23:59:59`) : null;
    if (startsAt && endsAt && endsAt < startsAt) return { error: 'It ends before it starts.' };

    const productIds = formData.getAll('productIds').map(String).filter(Boolean);
    const validProducts = productIds.length
      ? await db.product.findMany({
          where: { id: { in: productIds }, organizationId: tenant.organizationId },
          select: { id: true },
        })
      : [];

    // SINGLE means the code is claimable once in total, whatever the box says.
    const maxRedemptions =
      d.usageType === 'SINGLE' ? 1 : d.maxRedemptions && d.maxRedemptions > 0 ? d.maxRedemptions : null;

    const data = {
      organizationId: tenant.organizationId,
      code,
      description: d.description || null,
      discountType: d.discountType,
      discountValue: d.discountValue,
      maxDiscountPaise: d.maxDiscountRupees ? toPaise(d.maxDiscountRupees) : null,
      minOrderPaise: d.minOrderRupees ? toPaise(d.minOrderRupees) : null,
      usageType: d.usageType,
      maxRedemptions,
      perUserLimit: d.usageType === 'SINGLE' ? 1 : d.perUserLimit,
      startsAt,
      endsAt,
    };

    const clash = await db.promoCode.findFirst({
      where: { organizationId: tenant.organizationId, code, ...(id ? { id: { not: id } } : {}) },
      select: { id: true },
    });
    if (clash) return { error: `${code} is already in use.` };

    const saved = id
      ? await db.promoCode.update({ where: { id }, data, select: { id: true } })
      : await db.promoCode.create({ data, select: { id: true } });

    await db.$transaction([
      db.promoCodeProduct.deleteMany({ where: { promoCodeId: saved.id } }),
      db.promoCodeProduct.createMany({
        data: validProducts.map((p) => ({ promoCodeId: saved.id, productId: p.id })),
        skipDuplicates: true,
      }),
    ]);

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: id ? 'promo.updated' : 'promo.created',
      entity: 'PromoCode',
      entityId: saved.id,
      after: { code, discountType: d.discountType, discountValue: d.discountValue },
    });

    revalidatePath('/admin/promo-codes');
    return {
      ok: true,
      message: validProducts.length
        ? `${code} saved, valid on ${validProducts.length} ${validProducts.length === 1 ? 'course' : 'courses'}.`
        : `${code} saved, valid on everything.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function setPromoActive(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const promo = await db.promoCode.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!promo) return { error: 'Code not found.' };

    await db.promoCode.update({ where: { id }, data: { isActive } });

    revalidatePath('/admin/promo-codes');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deletePromoCode(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');

    const promo = await db.promoCode.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, _count: { select: { redemptions: true, orders: true } } },
    });
    if (!promo) return { error: 'Code not found.' };

    // A code somebody bought on is part of the accounting record.
    if (promo._count.redemptions > 0 || promo._count.orders > 0) {
      return { error: 'This code has been used, so it can be switched off but not deleted.' };
    }

    await db.promoCode.delete({ where: { id } });

    revalidatePath('/admin/promo-codes');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Applying one -------------------------------------------------------------- */

export interface PromoQuote {
  ok: boolean;
  code?: string;
  discountPaise?: number;
  label?: string;
  error?: string;
}

/**
 * What a code is worth here, without claiming it.
 *
 * Used by the checkout to show the learner a figure before they commit. It
 * repeats every check the claim makes, because a quote that says yes and a
 * payment that says no is the worst possible order of events.
 */
export async function quotePromoCode(
  rawCode: string,
  productId: string,
  subtotalPaise: number,
): Promise<PromoQuote> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();

    const refuse = (reason: PromoRefusal, min?: number | null): PromoQuote => ({
      ok: false,
      error: refusalMessage(reason, min),
    });

    const code = normaliseCode(rawCode);
    if (!code) return { ok: false, error: 'Type a code first.' };

    const promo = await db.promoCode.findFirst({
      where: { organizationId: tenant.organizationId, code },
      select: {
        id: true,
        code: true,
        isActive: true,
        discountType: true,
        discountValue: true,
        maxDiscountPaise: true,
        minOrderPaise: true,
        maxRedemptions: true,
        perUserLimit: true,
        startsAt: true,
        endsAt: true,
        products: { select: { productId: true } },
        _count: { select: { redemptions: true } },
      },
    });
    if (!promo) return refuse('NOT_FOUND');
    if (!promo.isActive) return refuse('INACTIVE');

    const now = new Date();
    if (promo.startsAt && promo.startsAt > now) return refuse('NOT_STARTED');
    if (promo.endsAt && promo.endsAt < now) return refuse('EXPIRED');

    if (promo.products.length > 0 && !promo.products.some((p) => p.productId === productId)) {
      return refuse('WRONG_PRODUCT');
    }
    if (promo.minOrderPaise && subtotalPaise < promo.minOrderPaise) {
      return refuse('UNDER_MINIMUM', promo.minOrderPaise);
    }
    if (promo.maxRedemptions != null && promo._count.redemptions >= promo.maxRedemptions) {
      return refuse('ALL_USED');
    }

    if (user) {
      const mine = await db.promoRedemption.count({
        where: { promoCodeId: promo.id, userId: user.id },
      });
      if (mine >= promo.perUserLimit) return refuse('ALREADY_USED');
    }

    const discountPaise = discountFor(promo, subtotalPaise);
    if (discountPaise <= 0) return { ok: false, error: 'That code is worth nothing on this order.' };

    return { ok: true, code: promo.code, discountPaise, label: promo.code };
  } catch (err) {
    console.error('[promo]', err instanceof Error ? err.message : err);
    return { ok: false, error: 'We could not check that code just now.' };
  }
}
