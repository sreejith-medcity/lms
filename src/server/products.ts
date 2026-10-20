'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { slugify, uniqueSlug } from '@/lib/slug';
import { recordAudit } from '@/lib/audit';
import type { ActionState } from '@/server/courses';
import { fromLocalInput } from '@/lib/clock';
import { HOLDS_SEAT } from '@/lib/seats';

/**
 * Events and memberships.
 *
 * Both are Products, which is why they get commerce, enrolment and entitlement
 * for free rather than each growing its own half-copy of checkout. An event is a
 * product that happens once at a place and time; a membership is a product that
 * unlocks a set of courses for a while.
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
  console.error('[products]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/* Events ------------------------------------------------------------------ */

const event = z.object({
  id: z.string().optional().or(z.literal('')),
  title: z.string().trim().min(3, 'Give the event a title').max(160),
  startsAt: z.string().min(1, 'When does it start?'),
  endsAt: z.string().optional().or(z.literal('')),
  isOnline: z.boolean(),
  venue: z.string().trim().max(240).optional().or(z.literal('')),
  summary: z.string().trim().max(2000).optional().or(z.literal('')),
  joinUrl: z.string().trim().max(500).optional().or(z.literal('')),
  capacity: z.coerce.number().min(0).max(100000).optional(),
  priceRupees: z.coerce.number().min(0).max(1000000),
  status: z.enum(['DRAFT', 'PUBLISHED']),
});

export async function saveEvent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('courses.events');

    const parsed = event.safeParse({
      id: formData.get('id') || '',
      title: formData.get('title'),
      startsAt: formData.get('startsAt'),
      endsAt: formData.get('endsAt') || '',
      isOnline: formData.get('isOnline') === 'on',
      venue: formData.get('venue') || '',
      summary: formData.get('summary') || '',
      joinUrl: formData.get('joinUrl') || '',
      capacity: formData.get('capacity') || 0,
      priceRupees: formData.get('priceRupees') || 0,
      status: formData.get('status') || 'DRAFT',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    // The form's times are the academy's clock, not the server's.
    const start = fromLocalInput(d.startsAt, tenant.timezone);
    const end = d.endsAt ? fromLocalInput(d.endsAt, tenant.timezone) : null;
    if (!start) return { error: 'That start time does not look right.' };
    if (end && end < start) return { error: 'It ends before it starts.' };
    if (!d.isOnline && !d.venue) return { error: 'An in-person event needs a venue.' };
    if (d.joinUrl && !/^https:\/\/\S+$/i.test(d.joinUrl)) return { error: 'The joining link should start with https://' };

    const pricePaise = Math.round(d.priceRupees * 100);
    const eventData = {
      startsAt: start,
      endsAt: end,
      isOnline: d.isOnline,
      venue: d.venue || null,
      summary: d.summary || null,
      joinUrl: d.isOnline ? d.joinUrl || null : null,
      capacity: d.capacity || null,
    };

    if (d.id) {
      const owned = await db.product.findFirst({
        where: { id: d.id, organizationId: tenant.organizationId, type: 'EVENT' },
        select: {
          id: true,
          pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: 1, select: { id: true, pricePaise: true, _count: { select: { enrollments: true } } } },
          _count: { select: { enrollments: { where: HOLDS_SEAT } } },
        },
      });
      if (!owned) return { error: 'Event not found.' };
      if (d.capacity && d.capacity < owned._count.enrollments) {
        return { error: `${owned._count.enrollments} people already have a place, so the capacity cannot be ${d.capacity}.` };
      }

      await db.product.update({
        where: { id: d.id },
        data: { title: d.title, status: d.status, event: { upsert: { create: eventData, update: eventData } } },
      });

      // A new price. The old plan is kept, inactive, when anyone holds a place
      // on it, because what they paid is history; otherwise it is just changed.
      const plan = owned.pricingPlans[0];
      if (!plan) {
        await db.pricingPlan.create({ data: { productId: d.id, name: pricePaise > 0 ? 'Ticket' : 'Free', pricePaise, sortOrder: 0 } });
      } else if (plan.pricePaise !== pricePaise) {
        if (plan._count.enrollments > 0) {
          await db.$transaction([
            db.pricingPlan.update({ where: { id: plan.id }, data: { isActive: false } }),
            db.pricingPlan.create({ data: { productId: d.id, name: pricePaise > 0 ? 'Ticket' : 'Free', pricePaise, sortOrder: 0 } }),
          ]);
        } else {
          await db.pricingPlan.update({ where: { id: plan.id }, data: { pricePaise, name: pricePaise > 0 ? 'Ticket' : 'Free' } });
        }
      }

      await recordAudit({
        organizationId: tenant.organizationId,
        actorId: user.id,
        action: 'event.updated',
        entity: 'Product',
        entityId: d.id,
        after: { title: d.title, status: d.status, pricePaise, capacity: d.capacity || null },
      });
    } else {
      const slug = await uniqueSlug(slugify(d.title), async (candidate) =>
        Boolean(
          await db.product.findFirst({
            where: { organizationId: tenant.organizationId, slug: candidate },
            select: { id: true },
          }),
        ),
      );

      const created = await db.product.create({
        data: {
          organizationId: tenant.organizationId,
          type: 'EVENT',
          title: d.title,
          slug,
          status: d.status,
          createdById: user.id,
          event: { create: eventData },
          pricingPlans: {
            create: {
              name: pricePaise > 0 ? 'Ticket' : 'Free',
              pricePaise,
              sortOrder: 0,
            },
          },
        },
        select: { id: true },
      });

      await recordAudit({
        organizationId: tenant.organizationId,
        actorId: user.id,
        action: 'event.created',
        entity: 'Product',
        entityId: created.id,
        after: { title: d.title },
      });
    }

    revalidatePath('/admin/events');
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

/* Memberships ------------------------------------------------------------- */

const membership = z.object({
  id: z.string().optional().or(z.literal('')),
  title: z.string().trim().min(3, 'Give the membership a name').max(160),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  billingPeriod: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']),
  priceRupees: z.coerce.number().min(0).max(1000000),
  validityDays: z.coerce.number().min(1).max(3650),
  status: z.enum(['DRAFT', 'PUBLISHED']),
});

export async function saveMembership(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('membership.manage_memberships');

    const parsed = membership.safeParse({
      id: formData.get('id') || '',
      title: formData.get('title'),
      description: formData.get('description') || '',
      billingPeriod: formData.get('billingPeriod') || 'MONTHLY',
      priceRupees: formData.get('priceRupees') || 0,
      validityDays: formData.get('validityDays') || 30,
      status: formData.get('status') || 'DRAFT',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const courseIds = formData.getAll('courseId').map((v) => String(v)).filter(Boolean);

    const valid = await db.course.findMany({
      where: { id: { in: courseIds }, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (valid.length === 0) {
      return { error: 'A membership has to unlock at least one course.' };
    }

    if (d.id) {
      const owned = await db.product.findFirst({
        where: { id: d.id, organizationId: tenant.organizationId, type: 'MEMBERSHIP' },
        select: { id: true, membership: { select: { id: true } } },
      });
      if (!owned?.membership) return { error: 'Membership not found.' };

      await db.$transaction([
        db.product.update({
          where: { id: d.id },
          data: {
            title: d.title,
            status: d.status,
            membership: {
              update: { billingPeriod: d.billingPeriod, description: d.description || null },
            },
          },
        }),
        db.membershipCourse.deleteMany({ where: { membershipId: owned.membership.id } }),
        db.membershipCourse.createMany({
          data: valid.map((c) => ({ membershipId: owned.membership!.id, courseId: c.id })),
          skipDuplicates: true,
        }),
      ]);
    } else {
      const slug = await uniqueSlug(slugify(d.title), async (candidate) =>
        Boolean(
          await db.product.findFirst({
            where: { organizationId: tenant.organizationId, slug: candidate },
            select: { id: true },
          }),
        ),
      );

      await db.product.create({
        data: {
          organizationId: tenant.organizationId,
          type: 'MEMBERSHIP',
          title: d.title,
          slug,
          status: d.status,
          createdById: user.id,
          membership: {
            create: {
              billingPeriod: d.billingPeriod,
              description: d.description || null,
              courses: { create: valid.map((c) => ({ courseId: c.id })) },
            },
          },
          pricingPlans: {
            create: {
              name: d.billingPeriod.toLowerCase(),
              pricePaise: Math.round(d.priceRupees * 100),
              validityDays: d.validityDays,
              sortOrder: 0,
            },
          },
        },
      });
    }

    revalidatePath('/admin/memberships');
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}
