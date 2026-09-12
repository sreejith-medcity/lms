import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { AssignmentEditor } from '../[id]/editor';
import { courseOptions } from '../options';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function NewAssignmentPage({ searchParams }: { searchParams: Promise<{ course?: string; batch?: string }> }) {
  const tenant = await requireTenant();
  await requireStaff('courses.assessments', 'edit');
  const { course, batch } = await searchParams;
  const courses = await courseOptions(db, tenant.organizationId);

  if (courses.length === 0) {
    return (
      <EmptyState title="No courses yet" hint="Homework belongs to a course. Create one first." action={<LinkButton href="/admin/courses">Courses</LinkButton>} />
    );
  }

  const first = courses.find((c) => c.id === course) ?? courses[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Set homework" description="A brief with a due date. Open it when it is ready; learners are told once, the first time." />
      <AssignmentEditor
        courses={courses}
        canDelete={false}
        draft={{
          courseId: first.id,
          batchId: batch && first.batches.some((b) => b.id === batch) ? batch : null,
          title: '',
          instructions: '',
          maxMarks: 100,
          dueAtLocal: '',
          acceptLate: true,
          allowResubmit: true,
          requireText: false,
          requireFile: false,
          status: 'DRAFT',
          hasHandIns: false,
        }}
      />
    </div>
  );
}
