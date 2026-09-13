import { db } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import type { BundleCourseOption } from './bundle-form';

/** Every course the academy could put in a bundle, with its headline price. */
export async function bundleCourseOptions(organizationId: string): Promise<BundleCourseOption[]> {
  const rows = await db.product.findMany({
    where: { organizationId, type: 'COURSE', deletedAt: null, isAddonOnly: false },
    orderBy: { title: 'asc' },
    select: {
      id: true,
      title: true,
      status: true,
      pricingPlans: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        take: 1,
        select: { pricePaise: true, currency: true },
      },
    },
  });
  return rows.map((r) => ({
    productId: r.id,
    title: r.title,
    published: r.status === 'PUBLISHED',
    priceLabel: r.pricingPlans[0] ? formatMoney(r.pricingPlans[0].pricePaise, r.pricingPlans[0].currency) : 'no price',
  }));
}
