import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { MATERIAL_LABELS } from '@/lib/progress';
import { Card, EmptyState } from '@/components/ui';
import { DripTable } from './table';

export const dynamic = 'force-dynamic';

export default async function DripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('module.drip', 'view');
  const canEdit = me.permissions['module.drip']?.edit ?? false;

  const product = await db.product.findFirst({
    where: { id, organizationId: tenant.organizationId, type: 'COURSE' },
    select: {
      id: true,
      course: {
        select: {
          id: true,
          dripRules: {
            select: { materialId: true, anchor: true, offsetDays: true, releaseAt: true },
          },
          modules: {
            orderBy: { sortOrder: 'asc' },
            select: {
              module: {
                select: {
                  id: true,
                  name: true,
                  sections: {
                    orderBy: { sortOrder: 'asc' },
                    select: {
                      id: true,
                      title: true,
                      materials: {
                        orderBy: { sortOrder: 'asc' },
                        select: { id: true, title: true, type: true },
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
  if (!product?.course) notFound();

  const ruleFor = new Map(
    product.course.dripRules
      .filter((r) => r.materialId)
      .map((r) => [
        r.materialId!,
        {
          anchor: r.anchor as string,
          offsetDays: r.offsetDays,
          releaseAt: r.releaseAt?.toISOString().slice(0, 10) ?? null,
        },
      ]),
  );

  const modules = product.course.modules.map((cm) => ({
    id: cm.module.id,
    name: cm.module.name,
    sections: cm.module.sections.map((s) => ({
      id: s.id,
      title: s.title,
      materials: s.materials.map((m) => ({
        id: m.id,
        title: m.title,
        typeLabel: MATERIAL_LABELS[m.type] ?? m.type,
        rule: ruleFor.get(m.id) ?? null,
      })),
    })),
  }));

  const lessons = modules.flatMap((m) => m.sections.flatMap((s) => s.materials));

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="t-heading">Release schedule</h2>
        <p className="t-small muted mt-1 max-w-prose">
          Three anchors, because academies mean three different things by &ldquo;week two&rdquo;:
          so many days after a learner enrols, so many days after their batch starts, or a fixed
          date for everybody. A locked lesson still shows in the course, greyed with the date it
          opens, so nobody wonders whether the course is short or they are missing something.
        </p>
        <p className="t-small faint mt-2">
          {lessons.filter((l) => l.rule).length} of {lessons.length} lessons are on a schedule. The
          rest are open from the start.
        </p>
      </Card>

      {lessons.length === 0 ? (
        <EmptyState
          title="No lessons yet"
          hint="Build the curriculum first, then decide when each part opens."
        />
      ) : (
        <DripTable productId={product.id} modules={modules} canEdit={canEdit} />
      )}
    </div>
  );
}
