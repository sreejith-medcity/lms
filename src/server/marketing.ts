'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff, getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import type { ActionState } from '@/server/courses';

/**
 * Testimonials and banners.
 *
 * Both are the storefront's furniture, and both are nothing until somebody
 * publishes them: a testimonial arrives unpublished on purpose, because a
 * quote on a public page is the academy speaking, whoever typed it.
 */

async function guard(permission: string, action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[marketing]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/* Testimonials -------------------------------------------------------------- */

const testimonialShape = z.object({
  authorName: z.string().trim().min(2, 'Whose words are these?').max(120),
  authorEmail: z.string().trim().email('That is not an email address').optional().or(z.literal('')),
  rating: z.coerce.number().min(1).max(5),
  comment: z.string().trim().min(10, 'A testimonial needs a sentence at least').max(1200),
  productId: z.string().trim().optional(),
});

export async function saveTestimonial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('testimonials.manage_testimonials');

    const id = String(formData.get('id') ?? '');
    const parsed = testimonialShape.safeParse({
      authorName: formData.get('authorName'),
      authorEmail: formData.get('authorEmail') || '',
      rating: formData.get('rating'),
      comment: formData.get('comment'),
      productId: formData.get('productId') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const productId = d.productId
      ? (
          await db.product.findFirst({
            where: { id: d.productId, organizationId: tenant.organizationId },
            select: { id: true },
          })
        )?.id ?? null
      : null;

    const data = {
      organizationId: tenant.organizationId,
      authorName: d.authorName,
      authorEmail: d.authorEmail || null,
      rating: d.rating,
      comment: d.comment,
      productId,
    };

    if (id) {
      const existing = await db.testimonial.findFirst({
        where: { id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) return { error: 'Testimonial not found.' };
      await db.testimonial.update({ where: { id }, data });
    } else {
      // Written by staff, so it is published straight away: somebody with the
      // permission to write it has already made the decision to show it.
      await db.testimonial.create({ data: { ...data, isPublished: true } });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: id ? 'testimonial.updated' : 'testimonial.created',
      entity: 'Testimonial',
      entityId: id || 'new',
      after: { authorName: d.authorName, rating: d.rating },
    });

    revalidatePath('/admin/testimonials');
    revalidatePath('/');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setTestimonialPublished(id: string, isPublished: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('testimonials.manage_testimonials');

    const testimonial = await db.testimonial.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, authorName: true },
    });
    if (!testimonial) return { error: 'Testimonial not found.' };

    await db.testimonial.update({ where: { id }, data: { isPublished } });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: isPublished ? 'testimonial.published' : 'testimonial.unpublished',
      entity: 'Testimonial',
      entityId: id,
      after: { authorName: testimonial.authorName },
    });

    revalidatePath('/admin/testimonials');
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteTestimonial(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('testimonials.manage_testimonials', 'delete');

    const testimonial = await db.testimonial.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!testimonial) return { error: 'Testimonial not found.' };

    await db.testimonial.delete({ where: { id } });

    revalidatePath('/admin/testimonials');
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * A learner's own words, from the learner.
 *
 * Only offered to somebody who finished the course, and it arrives unpublished:
 * the academy decides what goes on its own front page.
 */
export async function leaveTestimonial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };

    const productId = String(formData.get('productId') ?? '');
    const rating = Math.max(1, Math.min(5, Number(formData.get('rating') ?? 0)));
    const comment = String(formData.get('comment') ?? '').trim();

    if (!rating) return { error: 'Pick a rating first.' };
    if (comment.length < 10) return { error: 'Tell us a little more than that.' };

    const enrollment = await db.enrollment.findFirst({
      where: {
        userId: user.id,
        productId,
        organizationId: tenant.organizationId,
        status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      },
      select: { id: true, progressPercent: true },
    });
    if (!enrollment) return { error: 'You are not enrolled in that course.' };

    const existing = await db.testimonial.findFirst({
      where: { organizationId: tenant.organizationId, userId: user.id, productId },
      select: { id: true },
    });

    if (existing) {
      await db.testimonial.update({
        where: { id: existing.id },
        data: { rating, comment, isPublished: false },
      });
    } else {
      await db.testimonial.create({
        data: {
          organizationId: tenant.organizationId,
          userId: user.id,
          productId,
          authorName: user.name,
          authorEmail: user.email,
          rating,
          comment,
          isPublished: false,
        },
      });
    }

    revalidatePath('/learn');
    revalidatePath('/admin/testimonials');
    return { ok: true, message: 'Thank you. The academy will take a look before it goes up.' };
  } catch (err) {
    return fail(err);
  }
}

/* Banners ------------------------------------------------------------------- */

const PLACEMENTS = ['LEARNER_HOME', 'SITE_HOME', 'CATALOGUE'] as const;

const bannerShape = z.object({
  name: z.string().trim().min(2, 'Give the banner a name').max(120),
  imageAssetId: z.string().trim().optional(),
  linkUrl: z.string().trim().url('That is not a full URL').optional().or(z.literal('')),
  placement: z.enum(PLACEMENTS),
});

export async function saveBanner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant } = await guard('banner.manage_banners');

    const id = String(formData.get('id') ?? '');
    const parsed = bannerShape.safeParse({
      name: formData.get('name'),
      imageAssetId: formData.get('imageAssetId') || undefined,
      linkUrl: formData.get('linkUrl') || '',
      placement: formData.get('placement') || 'LEARNER_HOME',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    if (!d.imageAssetId) return { error: 'Upload the artwork first.' };

    const asset = await db.asset.findFirst({
      where: {
        id: d.imageAssetId,
        organizationId: tenant.organizationId,
        deletedAt: null,
        transcodeStatus: { not: 'UPLOADING' },
      },
      select: { id: true, type: true },
    });
    if (!asset) return { error: 'That image is still uploading, or is no longer available.' };
    if (asset.type !== 'IMAGE') return { error: 'A banner has to be an image.' };

    const count = await db.banner.count({ where: { organizationId: tenant.organizationId } });

    const data = {
      organizationId: tenant.organizationId,
      name: d.name,
      imageAssetId: asset.id,
      linkUrl: d.linkUrl || null,
      placement: d.placement,
    };

    if (id) {
      const existing = await db.banner.findFirst({
        where: { id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) return { error: 'Banner not found.' };
      await db.banner.update({ where: { id }, data });
    } else {
      await db.banner.create({ data: { ...data, sortOrder: count } });
    }

    revalidatePath('/admin/banners');
    revalidatePath('/learn');
    revalidatePath('/');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setBannerActive(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant } = await guard('banner.manage_banners');

    const banner = await db.banner.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!banner) return { error: 'Banner not found.' };

    await db.banner.update({ where: { id }, data: { isActive } });

    revalidatePath('/admin/banners');
    revalidatePath('/learn');
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function moveBanner(id: string, direction: 'up' | 'down'): Promise<ActionState> {
  try {
    const { tenant } = await guard('banner.manage_banners');

    const current = await db.banner.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, sortOrder: true, placement: true },
    });
    if (!current) return { error: 'Banner not found.' };

    const neighbour = await db.banner.findFirst({
      where: {
        organizationId: tenant.organizationId,
        placement: current.placement,
        sortOrder: direction === 'up' ? { lt: current.sortOrder } : { gt: current.sortOrder },
      },
      orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
      select: { id: true, sortOrder: true },
    });
    if (!neighbour) return { ok: true };

    await db.$transaction([
      db.banner.update({ where: { id: current.id }, data: { sortOrder: neighbour.sortOrder } }),
      db.banner.update({ where: { id: neighbour.id }, data: { sortOrder: current.sortOrder } }),
    ]);

    revalidatePath('/admin/banners');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteBanner(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('banner.manage_banners', 'delete');

    const banner = await db.banner.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!banner) return { error: 'Banner not found.' };

    await db.banner.delete({ where: { id } });

    revalidatePath('/admin/banners');
    revalidatePath('/learn');
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
