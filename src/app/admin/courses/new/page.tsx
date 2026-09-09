import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { PageHeader } from '@/components/ui';
import { NewCourseForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NewCoursePage() {
  const tenant = await requireTenant();

  const categories = await db.category.findMany({
    where: { organizationId: tenant.organizationId, isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true },
  });

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New course"
        description="Name it and get going. Curriculum, pricing and batches come next."
      />
      <NewCourseForm categories={categories} />
    </div>
  );
}
