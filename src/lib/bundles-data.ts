import { db } from '@/lib/db';
import { bundleSaving, type BundleSaving } from '@/lib/learning-paths';

/**
 * Bundles as the storefront sees them: title, picture, what is inside, the
 * price and the saving against the courses bought one by one.
 */

export interface BundleCardData {
  id: string;
  title: string;
  slug: string;
  isFeatured: boolean;
  thumbnailAssetId: string | null;
  courseTitles: string[];
  pricePaise: number | null;
  currency: string;
  saving: BundleSaving;
}

const planSelect = {
  where: { isActive: true },
  orderBy: { sortOrder: 'asc' },
  take: 1,
  select: { id: true, pricePaise: true, mrpPaise: true, currency: true, planType: true, instalmentCount: true },
} as const;

export async function publishedBundles(organizationId: string, take = 12): Promise<BundleCardData[]> {
  const rows = await db.product.findMany({
    where: { organizationId, type: 'BUNDLE', status: 'PUBLISHED', deletedAt: null },
    orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    take,
    select: {
      id: true,
      title: true,
      slug: true,
      isFeatured: true,
      pricingPlans: planSelect,
      bundle: {
        select: {
          thumbnailAssetId: true,
          items: {
            orderBy: { sortOrder: 'asc' },
            select: { product: { select: { title: true, pricingPlans: planSelect, course: { select: { thumbnailAssetId: true } } } } },
          },
        },
      },
    },
  });
  return rows.map((r) => {
    const plan = r.pricingPlans[0];
    const items = r.bundle?.items ?? [];
    return {
      id: r.id,
      title: r.title,
      slug: r.slug,
      isFeatured: r.isFeatured,
      thumbnailAssetId: r.bundle?.thumbnailAssetId ?? items[0]?.product.course?.thumbnailAssetId ?? null,
      courseTitles: items.map((i) => i.product.title),
      pricePaise: plan?.pricePaise ?? null,
      currency: plan?.currency ?? 'INR',
      saving: bundleSaving(plan?.pricePaise ?? 0, items.map((i) => i.product.pricingPlans[0]?.pricePaise ?? 0)),
    };
  });
}

/** The bundles a course is sold inside, for the course page. */
export async function bundlesContaining(organizationId: string, productId: string): Promise<BundleCardData[]> {
  const rows = await db.bundleItem.findMany({
    where: { productId, bundle: { organizationId, product: { status: 'PUBLISHED', deletedAt: null } } },
    select: { bundle: { select: { productId: true } } },
  });
  if (rows.length === 0) return [];
  const all = await publishedBundles(organizationId, 50);
  const wanted = new Set(rows.map((r) => r.bundle.productId));
  return all.filter((b) => wanted.has(b.id));
}
