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
        _count: { select: { courses: true } },
      },
    }),
  ]);

  if (!organization) return null;

  return {
    tenantId: tenant.tenantId,
    organizationId: tenant.organizationId,
    organization,
    // A category with nothing published behind it is a dead end for a visitor.
    categories: categories.filter((c) => c._count.courses > 0),
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
    select: { pricePaise: true, mrpPaise: true, currency: true, validityDays: true },
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
    categories: { category: { name: string; slug: string } }[];
    modules: { module: { sections: { _count: { materials: number } }[] } }[];
    batches: { id: string; name: string; startDate: Date | null; status: string }[];
  } | null;
  pricingPlans: {
    pricePaise: number;
    mrpPaise: number | null;
    currency: string;
    validityDays: number | null;
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
