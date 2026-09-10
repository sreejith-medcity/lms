import { cache } from 'react';
import type { BatchStatus, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';

/**
 * Everything the public site needs about the academy it is showing. Cached per
 * request, because the header, the footer and the page body all want it.
 */
export const getSiteContext = cache(async () => {
  const tenant = await getTenantContext();
  if (!tenant) return null;

  const [organization, categories] = await Promise.all([
    db.organization.findUnique({
      where: { id: tenant.organizationId },
      select: {
        id: true,
        name: true,
        website: true,
        supportEmail: true,
        contactNumber: true,
        addressLine: true,
        city: true,
        state: true,
        pincode: true,
        currency: true,
        logoUrl: true,
        brandColor: true,
        social: true,
      },
    }),
    db.category.findMany({
      where: { organizationId: tenant.organizationId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        tagline: true,
        imageAssetId: true,
        ctaLabel: true,
        comingSoon: true,
        showOnHome: true,
        _count: { select: { courses: true } },
      },
    }),
  ]);

  if (!organization) return null;

  return {
    tenantId: tenant.tenantId,
    organizationId: tenant.organizationId,
    organization,
    // A category with nothing published behind it is a dead end for a visitor,
    // so it stays out of the filter rail on the catalogue.
    categories: categories.filter((c) => c._count.courses > 0),
    // The home page is the other case. A subject announced but not open yet
    // is worth showing, because "coming soon" is information; it just does
    // not get a link to an empty page.
    homeCategories: categories.filter(
      (c) => c.showOnHome && (c._count.courses > 0 || c.comingSoon),
    ),
  };
});

/** The shape every course card on the public site is built from. */
export const courseCardSelect: Prisma.ProductSelect = {
  id: true,
  title: true,
  slug: true,
  isFeatured: true,
  course: {
    select: {
      description: true,
      level: true,
      language: true,
      durationMinutes: true,
      thumbnailAssetId: true,
      accessAfterCompletion: true,
      categories: { select: { category: { select: { name: true, slug: true } } } },
      modules: {
        select: {
          module: { select: { sections: { select: { _count: { select: { materials: true } } } } } },
        },
      },
      batches: {
        where: { status: { in: ['UPCOMING', 'ACTIVE'] as BatchStatus[] }, deletedAt: null },
        orderBy: { startDate: 'asc' },
        take: 1,
        select: { id: true, name: true, startDate: true, status: true },
      },
    },
  },
  pricingPlans: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    take: 1,
    select: { pricePaise: true, mrpPaise: true, currency: true, validityDays: true, instalmentCount: true },
  },
};

export type CourseCard = {
  id: string;
  title: string;
  slug: string;
  isFeatured: boolean;
  course: {
    description: string | null;
    level: string | null;
    language: string | null;
    durationMinutes: number | null;
    thumbnailAssetId: string | null;
    accessAfterCompletion: boolean;
    categories: { category: { name: string; slug: string } }[];
    modules: { module: { sections: { _count: { materials: number } }[] } }[];
    batches: { id: string; name: string; startDate: Date | null; status: string }[];
  } | null;
  pricingPlans: {
    pricePaise: number;
    mrpPaise: number | null;
    currency: string;
    validityDays: number | null;
    instalmentCount: number;
  }[];
};

export function materialCount(card: CourseCard): number {
  return (
    card.course?.modules.reduce(
      (n, m) => n + m.module.sections.reduce((s, sec) => s + sec._count.materials, 0),
      0,
    ) ?? 0
  );
}

/** Live, recorded or blended, worked out from what the course actually has. */
export function learningFormat(card: CourseCard): 'Live' | 'Recorded' | 'Blended' {
  const hasBatches = (card.course?.batches.length ?? 0) > 0;
  const hasMaterial = materialCount(card) > 0;
  if (hasBatches && hasMaterial) return 'Blended';
  return hasBatches ? 'Live' : 'Recorded';
}

/** The saving on a card, as a whole percentage, or null when there is none. */
export function savingPercent(plan?: { pricePaise: number; mrpPaise: number | null }): number | null {
  if (!plan?.mrpPaise || plan.mrpPaise <= plan.pricePaise) return null;
  const pc = Math.round(((plan.mrpPaise - plan.pricePaise) / plan.mrpPaise) * 100);
  return pc >= 5 ? pc : null;
}

/**
 * The one-line fact strip under a card title: level, hours, language.
 *
 * Every part of it is read from the course rather than written by a marketer,
 * so a card can never claim a duration the curriculum does not have.
 */
export function metaLine(card: CourseCard): string {
  const parts: string[] = [learningFormat(card)];
  if (card.course?.level) parts.push(card.course.level);
  const minutes = card.course?.durationMinutes ?? 0;
  if (minutes > 0) {
    parts.push(minutes >= 90 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`);
  }
  return parts.join(' · ');
}

/**
 * Up to three things a buyer actually gets, each one true of this course.
 *
 * The WordPress cards carried three hand-written bullets per product, which is
 * fine for sixty-five products maintained by one person and impossible for a
 * catalogue an institute edits itself. These are derived, so they cannot drift
 * away from the course they describe.
 */
export function courseHighlights(card: CourseCard): string[] {
  const out: string[] = [];
  const lessons = materialCount(card);
  const batch = card.course?.batches[0];
  const plan = card.pricingPlans[0];

  if (batch) out.push('Live classes with a trainer');
  if (lessons > 0) out.push(`${lessons} recorded lesson${lessons === 1 ? '' : 's'}`);
  if (batch) out.push('Recordings of every class');
  if (plan?.validityDays) out.push(`${plan.validityDays} days of access`);
  else if (card.course?.accessAfterCompletion) out.push('Access continues after you finish');
  if ((plan?.instalmentCount ?? 0) > 1) out.push(`Pay in ${plan!.instalmentCount} instalments`);
  out.push('Certificate on completion');

  return out.slice(0, 3);
}

/**
 * Published ratings for a set of products, in one query rather than one per
 * card. A course with nothing published against it is absent from the map,
 * which is how a card knows to say nothing rather than to show zero stars.
 */
export async function ratingsFor(
  organizationId: string,
  productIds: string[],
): Promise<Map<string, { average: number; count: number }>> {
  const out = new Map<string, { average: number; count: number }>();
  if (productIds.length === 0) return out;

  const rows = await db.testimonial.groupBy({
    by: ['productId'],
    where: { organizationId, isPublished: true, productId: { in: productIds } },
    _avg: { rating: true },
    _count: { _all: true },
  });

  for (const row of rows) {
    if (!row.productId || !row._avg.rating) continue;
    out.set(row.productId, {
      average: Math.round(row._avg.rating * 10) / 10,
      count: row._count._all,
    });
  }
  return out;
}
