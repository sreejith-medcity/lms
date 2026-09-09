import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { DetailsForm } from './details-form';

export const dynamic = 'force-dynamic';

export default async function CourseDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();

  const product = await db.product.findFirst({
    where: { id, organizationId: tenant.organizationId, type: 'COURSE' },
    include: { course: true },
  });
  if (!product?.course) notFound();

  return (
    <div className="max-w-2xl">
      <DetailsForm
        productId={product.id}
        title={product.title}
        course={{
          description: product.course.description ?? '',
          level: product.course.level ?? '',
          language: product.course.language ?? '',
          promoVideoUrl: product.course.promoVideoUrl ?? '',
          modulesArePrerequisite: product.course.modulesArePrerequisite,
          learnerCanComplete: product.course.learnerCanComplete,
          milestoneCelebrations: product.course.milestoneCelebrations,
          accessAfterCompletion: product.course.accessAfterCompletion,
        }}
      />
    </div>
  );
}
