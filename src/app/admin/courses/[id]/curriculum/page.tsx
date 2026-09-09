import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { storageConfigured } from '@/lib/storage';
import { Card, EmptyState } from '@/components/ui';
import { AddModule, AddSection, AddMaterial, MaterialRow, UnlinkModule } from './editors';

export const dynamic = 'force-dynamic';

export default async function CurriculumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const storageReady = storageConfigured();

  const product = await db.product.findFirst({
    where: { id, organizationId: tenant.organizationId, type: 'COURSE' },
    select: { id: true, course: { select: { id: true } } },
  });
  if (!product?.course) notFound();

  const links = await db.courseModule.findMany({
    where: { courseId: product.course.id },
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
  });

  // Modules already in the library but not on this course, offered for linking.
  const linkedIds = links.map((l) => l.moduleId);
  const libraryModules = await db.module.findMany({
    where: {
      organizationId: tenant.organizationId,
      deletedAt: null,
      ...(linkedIds.length ? { id: { notIn: linkedIds } } : {}),
    },
    orderBy: { name: 'asc' },
    take: 100,
    select: { id: true, name: true, _count: { select: { sections: true } } },
  });

  return (
    <div className="space-y-6">
      <AddModule productId={product.id} library={libraryModules} />

      {links.length === 0 && (
        <EmptyState
          title="No modules yet"
          hint="A module holds sections, and sections hold the actual materials."
        />
      )}

      {links.map((link) => {
        const materialCount = link.module.sections.reduce((n, s) => n + s.materials.length, 0);
        const seconds = link.module.sections.reduce(
          (n, s) => n + s.materials.reduce((m, mat) => m + (mat.durationSeconds ?? 0), 0),
          0,
        );

        return (
          <Card key={link.moduleId} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <div>
                <h2 className="font-medium">{link.module.name}</h2>
                <p className="t-small faint">
                  {link.module.sections.length} sections · {materialCount} materials
                  {seconds > 0 && ` · ${formatDuration(seconds)}`}
                </p>
              </div>
              <UnlinkModule productId={product.id} moduleId={link.moduleId} />
            </div>

            {link.module.sections.map((section) => (
              <div key={section.id} className="rounded-[var(--radius-sm)] border">
                <div className="border-b bg-[var(--surface-2)] px-4 py-2">
                  <h3 className="text-sm font-medium">{section.title}</h3>
                </div>

                <ul className="divide-y">
                  {section.materials.map((m) => (
                    <MaterialRow
                      key={m.id}
                      productId={product.id}
                      material={{
                        id: m.id,
                        title: m.title,
                        type: m.type,
                        isFreePreview: m.isFreePreview,
                        durationSeconds: m.durationSeconds,
                      }}
                    />
                  ))}
                  {section.materials.length === 0 && (
                    <li className="px-4 py-3 t-small faint">No materials in this section.</li>
                  )}
                </ul>

                <div className="border-t bg-[var(--surface-2)] px-4 py-3">
                  <AddMaterial productId={product.id} sectionId={section.id} storageReady={storageReady} />
                </div>
              </div>
            ))}

            <AddSection productId={product.id} moduleId={link.moduleId} />
          </Card>
        );
      })}
    </div>
  );
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
