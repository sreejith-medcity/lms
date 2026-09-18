import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { batchWhere, staffScope } from '@/lib/scope';
import { STANDARD_CATEGORIES } from '@/lib/programs';
import { Card, PageHeader } from '@/components/ui';
import { NewSheetForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function NewMarkSheet({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const tenant = await requireTenant();
  const me = await requireStaff('courses.assessments', 'edit');
  const scope = await staffScope(me);
  const { batch } = await searchParams;

  const batches = await db.batch.findMany({
    where: { organizationId: tenant.organizationId, deletedAt: null, status: { in: ['ACTIVE', 'UPCOMING', 'COMPLETED'] }, ...batchWhere(scope) },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, level: true, course: { select: { product: { select: { title: true } }, program: { select: { assessmentCategories: true, skills: true, passPercent: true } } } } },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New mark sheet" description="For a test sat on paper. The marks are typed in on the next screen, one line per learner." />
      <Card>
        <NewSheetForm
          preselected={batch ?? ''}
          batches={batches.map((b) => ({
            id: b.id,
            label: `${b.name} · ${b.course.product.title}${b.level ? ` · ${b.level}` : ''}`,
            categories: b.course.program?.assessmentCategories.length ? b.course.program.assessmentCategories : [...STANDARD_CATEGORIES],
            skills: b.course.program?.skills ?? [],
            passPercent: b.course.program?.passPercent ?? null,
          }))}
        />
      </Card>
    </div>
  );
}
