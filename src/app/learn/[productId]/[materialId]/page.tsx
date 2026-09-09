import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { MATERIAL_LABELS, formatDuration } from '@/lib/progress';
import { Rail, type RailModule } from './rail';
import { Stage } from './stage';

export const dynamic = 'force-dynamic';

export default async function MaterialPage({
  params,
}: {
  params: Promise<{ productId: string; materialId: string }>;
}) {
  const { productId, materialId } = await params;
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
    select: {
      id: true,
      product: { select: { title: true, course: { select: { id: true } } } },
    },
  });
  if (!enrollment?.product.course) notFound();

  const modules = await db.courseModule.findMany({
    where: { courseId: enrollment.product.course.id },
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
                select: {
                  id: true,
                  title: true,
                  type: true,
                  assetId: true,
                  externalUrl: true,
                  bodyHtml: true,
                  isDownloadable: true,
                  durationSeconds: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const ordered = modules.flatMap((cm) => cm.module.sections.flatMap((s) => s.materials));
  const index = ordered.findIndex((m) => m.id === materialId);
  if (index === -1) notFound();

  const material = ordered[index];
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index < ordered.length - 1 ? ordered[index + 1] : null;

  const [progressRows, notes] = await Promise.all([
    db.materialProgress.findMany({
      where: { userId: user.id, materialId: { in: ordered.map((m) => m.id) } },
      select: {
        materialId: true,
        completedAt: true,
        isBookmarked: true,
        positionSeconds: true,
      },
    }),
    db.learnerNote.findMany({
      where: { userId: user.id, materialId },
      orderBy: [{ atSeconds: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, body: true, atSeconds: true, createdAt: true },
    }),
  ]);

  const byMaterial = new Map(progressRows.map((p) => [p.materialId, p]));
  const here = byMaterial.get(materialId);

  const railModules: RailModule[] = modules.map((cm) => ({
    id: cm.module.id,
    name: cm.module.name,
    sections: cm.module.sections.map((s) => ({
      id: s.id,
      title: s.title,
      materials: s.materials.map((m) => ({
        id: m.id,
        title: m.title,
        typeLabel: MATERIAL_LABELS[m.type] ?? m.type,
        duration: formatDuration(m.durationSeconds),
        done: Boolean(byMaterial.get(m.id)?.completedAt),
        bookmarked: Boolean(byMaterial.get(m.id)?.isBookmarked),
      })),
    })),
  }));

  const completed = ordered.filter((m) => byMaterial.get(m.id)?.completedAt).length;

  return (
    <div className="-mx-5 -my-6 flex flex-col lg:flex-row">
      <Rail
        productId={productId}
        courseTitle={enrollment.product.title}
        currentId={materialId}
        modules={railModules}
        completed={completed}
        total={ordered.length}
      />

      <Stage
        productId={productId}
        material={{
          id: material.id,
          title: material.title,
          type: material.type,
          typeLabel: MATERIAL_LABELS[material.type] ?? material.type,
          assetId: material.assetId,
          externalUrl: material.externalUrl,
          bodyHtml: material.bodyHtml,
          isDownloadable: material.isDownloadable,
          durationSeconds: material.durationSeconds,
        }}
        position={index + 1}
        total={ordered.length}
        startAt={here?.positionSeconds ?? 0}
        done={Boolean(here?.completedAt)}
        bookmarked={Boolean(here?.isBookmarked)}
        prevId={prev?.id ?? null}
        nextId={next?.id ?? null}
        notes={notes.map((n) => ({
          id: n.id,
          body: n.body,
          atSeconds: n.atSeconds,
          createdAt: n.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
