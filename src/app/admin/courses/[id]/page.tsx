import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { DetailsForm, type OverviewBlock } from './details-form';
import { AddonsForm } from './addons-form';

export const dynamic = 'force-dynamic';

export default async function CourseDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();

  const product = await db.product.findFirst({
    where: { id, organizationId: tenant.organizationId, type: 'COURSE' },
    include: { course: true },
  });
  if (!product?.course) notFound();

  const overviewBlocks = Array.isArray(product.course.overviewBlocks)
    ? (product.course.overviewBlocks as OverviewBlock[])
    : [];

  const planSelect = {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    take: 1,
    select: { pricePaise: true, currency: true },
  } as const;

  const [attachedRows, candidateRows] = await Promise.all([
    db.productAddon.findMany({
      where: { organizationId: tenant.organizationId, productId: product.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        label: true,
        note: true,
        isPreselected: true,
        addonProduct: { select: { title: true, pricingPlans: planSelect } },
      },
    }),
    // Anything else in this catalogue with a real price on it. A product with
    // no active priced plan is left out, because a tick box for it would add
    // nothing to the order and the buyer would get it for free.
    db.product.findMany({
      where: {
        organizationId: tenant.organizationId,
        deletedAt: null,
        id: { not: product.id },
        pricingPlans: { some: { isActive: true, pricePaise: { gt: 0 } } },
      },
      orderBy: { title: 'asc' },
      take: 200,
      select: { id: true, title: true, pricingPlans: planSelect },
    }),
  ]);

  const money = (plans: { pricePaise: number; currency: string }[]) =>
    plans[0] ? formatMoney(plans[0].pricePaise, plans[0].currency) : 'no price';

  const attachedIds = new Set(attachedRows.map((r) => r.id));

  return (
    <div className="max-w-3xl space-y-4">
      <DetailsForm
        productId={product.id}
        title={product.title}
        course={{
          description: product.course.description ?? '',
          level: product.course.level ?? '',
          language: product.course.language ?? '',
          prettyName: product.course.prettyName ?? '',
          durationHours: product.course.durationMinutes
            ? Math.round((product.course.durationMinutes / 60) * 2) / 2
            : 0,
          promoVideoUrl: product.course.promoVideoUrl ?? '',
          overviewLinkOverride: product.course.overviewLinkOverride ?? '',
          thumbnailAssetId: product.course.thumbnailAssetId,
          overviewBlocks,
          modulesArePrerequisite: product.course.modulesArePrerequisite,
          learnerCanComplete: product.course.learnerCanComplete,
          milestoneCelebrations: product.course.milestoneCelebrations,
          accessAfterCompletion: product.course.accessAfterCompletion,
        }}
      />

      <AddonsForm
        productId={product.id}
        isAddonOnly={product.isAddonOnly}
        attached={attachedRows.map((r) => ({
          id: r.id,
          title: r.addonProduct.title,
          label: r.label,
          note: r.note,
          isPreselected: r.isPreselected,
          priceLabel: money(r.addonProduct.pricingPlans),
        }))}
        candidates={candidateRows
          .filter((c) => !attachedIds.has(c.id))
          .map((c) => ({ id: c.id, title: c.title, priceLabel: money(c.pricingPlans) }))}
      />
    </div>
  );
}
