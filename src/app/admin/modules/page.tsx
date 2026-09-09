import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatDuration } from '@/lib/progress';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { ModuleForm, ModuleRow } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function ModulesPage() {
  const tenant = await requireTenant();
  await requireStaff('module.module_library', 'view');

  const modules = await db.module.findMany({
    where: { organizationId: tenant.organizationId, deletedAt: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      sections: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          title: true,
          materials: { select: { id: true, durationSeconds: true } },
        },
      },
      courses: {
        select: { course: { select: { id: true, product: { select: { id: true, title: true } } } } },
      },
    },
  });

  const orphans = modules.filter((m) => m.courses.length === 0).length;

  return (
    <div>
      <PageHeader
        title="Module library"
        description="Modules are shared. The same A1 grammar module can sit in three courses and two batches, written once and corrected once."
      />

      {orphans > 0 && (
        <p className="t-small mb-4 rounded-[var(--radius-sm)] border border-dashed p-3 text-[var(--warn)]">
          {orphans} module{orphans === 1 ? ' is' : 's are'} not used by any course. Either they are
          being prepared, or they were abandoned.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {modules.length === 0 ? (
            <EmptyState
              title="The library is empty"
              hint="Modules can be created here, or from inside a course as you build it."
            />
          ) : (
            modules.map((m) => {
              const materials = m.sections.flatMap((s) => s.materials);
              const seconds = materials.reduce((n, mat) => n + (mat.durationSeconds ?? 0), 0);

              return (
                <Card key={m.id}>
                  <ModuleRow
                    module={{ id: m.id, name: m.name, description: m.description }}
                    usedBy={m.courses.length}
                  />

                  <p className="t-small faint mt-1 tabular-nums">
                    {m.sections.length} section{m.sections.length === 1 ? '' : 's'} ·{' '}
                    {materials.length} lesson{materials.length === 1 ? '' : 's'}
                    {seconds > 0 ? ` · ${formatDuration(seconds)}` : ''}
                  </p>

                  {m.courses.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {m.courses.map((c) => (
                        <Link
                          key={c.course.id}
                          href={`/admin/courses/${c.course.product.id}/curriculum`}
                          className="t-micro rounded-full border px-2 py-1 hover:border-[var(--brand)]"
                        >
                          {c.course.product.title}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3">
                      <Badge tone="warn">not in any course</Badge>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>

        <Card>
          <h2 className="t-heading">New module</h2>
          <p className="t-small muted mt-1">
            Sections and lessons are added from inside a course, where you can see the shape of
            what you are building.
          </p>
          <div className="mt-5">
            <ModuleForm />
          </div>
        </Card>
      </div>
    </div>
  );
}
