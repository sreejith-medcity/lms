import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { canonicalHost } from '@/lib/canonical-host';

export const dynamic = 'force-dynamic';

/**
 * Built from the live catalogue, so it cannot drift from what is actually
 * published. Private routes are absent by construction: nothing under /admin or
 * /learn is ever queried here.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The primary domain, not whichever name this request arrived on. A
  // sitemap listing a rehearsal host is a sitemap asking to be indexed twice.
  const base = (await canonicalHost()).origin;

  const tenant = await getTenantContext();
  if (!tenant) return [{ url: base, changeFrequency: 'weekly', priority: 1 }];

  const [products, categories, policies, posts, pages] = await Promise.all([
    db.product.findMany({
      where: {
        organizationId: tenant.organizationId,
        type: 'COURSE',
        status: 'PUBLISHED',
        deletedAt: null,
      },
      select: { slug: true, updatedAt: true },
    }),
    db.category.findMany({
      where: { organizationId: tenant.organizationId, isActive: true },
      select: { slug: true },
    }),
    db.policy.findMany({
      where: { organizationId: tenant.organizationId },
      select: { kind: true, updatedAt: true },
    }),
    db.blogPost.findMany({
      where: { organizationId: tenant.organizationId, status: 'PUBLISHED' },
      select: { slug: true, publishedAt: true },
    }),
    db.storefrontPage.findMany({
      where: {
        organizationId: tenant.organizationId,
        status: 'PUBLISHED',
        kind: { in: ['STATIC', 'COURSE_LANDING'] },
      },
      select: { slug: true, updatedAt: true, kind: true },
    }),
  ]);

  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/courses`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/about`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/contact`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/help`, changeFrequency: 'monthly', priority: 0.4 },
    ...categories.map((c) => ({
      url: `${base}/courses/${c.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...products.map((p) => ({
      url: `${base}/course/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    })),
    ...(posts.length > 0
      ? [{ url: `${base}/blog`, changeFrequency: 'weekly' as const, priority: 0.6 }]
      : []),
    ...posts.map((p) => ({
      url: `${base}/blog/${p.slug}`,
      lastModified: p.publishedAt ?? undefined,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    /* A course landing page is the address that course is actually sold
       from, so it ranks with the course pages rather than with the static
       ones. Its /course/<slug> twin points here as canonical. */
    ...pages.map((p) => ({
      url: `${base}/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: p.kind === 'COURSE_LANDING' ? ('weekly' as const) : ('monthly' as const),
      priority: p.kind === 'COURSE_LANDING' ? 0.9 : 0.5,
    })),
    ...policies.map((p) => ({
      url: `${base}/policies/${p.kind.toLowerCase()}`,
      lastModified: p.updatedAt,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
  ];
}
