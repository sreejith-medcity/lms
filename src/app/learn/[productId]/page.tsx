import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { MATERIAL_LABELS, formatDuration, percent } from '@/lib/progress';
import { Card, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CourseOutline({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const enrollment = await db.enrollment.findFirst({
    where: {
      userId: user.id,
      productId,
      organizationId: tenant.organizationId,
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
    },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          course: {
            select: {
              modulesArePrerequisite: true,
              modules: {
                orderBy: { sortOrder: 'asc' },
                include: {
                  module: {
                    include: {
                      sections: {
                        orderBy: { sortOrder: 'asc' },
                        include: { materials: { orderBy: { sortOrder: 'asc' } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!enrollment?.product.course) notFound();

  const done = await db.materialProgress.findMany({
    where: { userId: user.id, completedAt: { not: null } },
    select: { materialId: true },
  });
  const doneSet = new Set(done.map((d) => d.materialId));

  const materials = enrollment.product.course.modules.flatMap((cm) =>
    cm.module.sections.flatMap((s) => s.materials),
  );
  const completed = materials.filter((m) => doneSet.has(m.id)).length;
  const next = materials.find((m) => !doneSet.has(m.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/learn" className="text-sm text-slate-500 hover:underline">
            My learning
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{enrollment.product.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {completed} of {materials.length} done · {percent(completed, materials.length)}%
          </p>
        </div>

        {next && (
          <Link
            href={`/learn/${productId}/${next.id}`}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ background: 'var(--brand)' }}
          >
            {completed === 0 ? 'Start' : 'Continue'}
          </Link>
        )}
      </div>

      {materials.length === 0 && (
        <EmptyState title="No content yet" hint="Your academy is still preparing this course." />
      )}

      {enrollment.product.course.modules.map((cm) => (
        <Card key={cm.moduleId} className="space-y-4">
          <h2 className="font-medium">{cm.module.name}</h2>

          {cm.module.sections.map((section) => (
            <div key={section.id}>
              <p className="mb-1 text-sm font-medium text-slate-700">{section.title}</p>
              <ul className="divide-y rounded-lg border">
                {section.materials.map((m) => {
                  const isDone = doneSet.has(m.id);
                  return (
                    <li key={m.id}>
                      <Link
                        href={`/learn/${productId}/${m.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span
                            aria-hidden
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${
                              isDone ? 'border-transparent text-white' : 'text-transparent'
                            }`}
                            style={isDone ? { background: 'var(--brand)' } : undefined}
                          >
                            ✓
                          </span>
                          <span className="truncate text-sm">{m.title}</span>
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {MATERIAL_LABELS[m.type] ?? m.type}
                          {m.durationSeconds ? ` · ${formatDuration(m.durationSeconds)}` : ''}
                        </span>
                      </Link>
                    </li>
                  );
                })}
                {section.materials.length === 0 && (
                  <li className="px-4 py-2.5 text-sm text-slate-400">Nothing here yet.</li>
                )}
              </ul>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
