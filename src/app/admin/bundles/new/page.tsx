import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { BundleForm } from '../bundle-form';
import { bundleCourseOptions } from '../options';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function NewBundlePage() {
  const tenant = await requireTenant();
  await requireStaff('courses.course_management', 'edit');
  const courses = await bundleCourseOptions(tenant.organizationId);

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="New bundle"
        description="Name it, pick the courses in order, then set a price on the next screen. It stays a draft until you publish it."
      />
      <BundleForm bundle={null} courses={courses} canDelete={false} />
    </div>
  );
}
