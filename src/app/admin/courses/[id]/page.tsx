import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { DetailsForm, type OverviewBlock } from './details-form';

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

  return (
    <div className="max-w-3xl">
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
    </div>
  );
}
