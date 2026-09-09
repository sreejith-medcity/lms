import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { MATERIAL_LABELS, formatDuration } from '@/lib/progress';
import { curriculumGate } from '@/lib/curriculum-access';
import { Card } from '@/components/ui';
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
      batchId: true,
      createdAt: true,
      product: { select: { title: true, course: { select: { id: true } } } },
    },
  });
  if (!enrollment?.product.course) notFound();

  const gate = await curriculumGate({
    courseId: enrollment.product.course.id,
    enrolledAt: enrollment.createdAt,
    batchId: enrollment.batchId,
  });

  const allModules = await db.courseModule.findMany({
    where: { courseId: enrollment.product.course.id },
    orderBy: { sortOrder: 'asc' },
    select: {
      module: {
        select: {
          id: true,
          name: true,
          sections: {
            where: { isVisible: true },
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

  const modules = allModules.filter((cm) => gate.teaches(cm.module.id));

  // Section id travels with the lesson: a drip rule can be written on either.
  const ordered = modules.flatMap((cm) =>
    cm.module.sections.flatMap((s) => s.materials.map((m) => ({ ...m, sectionId: s.id }))),
  );
  const index = ordered.findIndex((m) => m.id === materialId);
  if (index === -1) notFound();

  const material = ordered[index];
  const lock = gate.lockOf(material.id, material.sectionId);

  // Skip past locked lessons rather than offering a next that refuses to open.
  const prev = ordered.slice(0, index).reverse().find((m) => !gate.lockOf(m.id, m.sectionId)) ?? null;
  const next = ordered.slice(index + 1).find((m) => !gate.lockOf(m.id, m.sectionId)) ?? null;

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
      materials: s.materials.map((m) => {
        const materialLock = gate.lockOf(m.id, s.id);
        return {
          id: m.id,
          title: m.title,
          typeLabel: MATERIAL_LABELS[m.type] ?? m.type,
          duration: formatDuration(m.durationSeconds),
          done: Boolean(byMaterial.get(m.id)?.completedAt),
          bookmarked: Boolean(byMaterial.get(m.id)?.isBookmarked),
          lockedLabel: materialLock?.label ?? null,
        };
      }),
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

      {lock ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <Card className="max-w-md text-center">
            <p className="text-3xl" aria-hidden>
              🔒
            </p>
            <h1 className="t-heading mt-3">{material.title}</h1>
            <p className="t-small muted mt-2">
              This lesson opens on{' '}
              {lock.until.toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              . Your academy releases this course a piece at a time, so the rest of it is already
              waiting for you.
            </p>
            {next && (
              <Link
                href={`/learn/${productId}/${next.id}`}
                className="mt-4 inline-flex rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-[var(--brand-ink)]"
                style={{ background: 'var(--brand)' }}
              >
                Go to the next open lesson
              </Link>
            )}
          </Card>
        </div>
      ) : (
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
      )}
    </div>
  );
}
