import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { MATERIAL_LABELS, formatDuration } from '@/lib/progress';
import { MaterialViewer } from '@/components/material-viewer';
import { CompleteButton } from './complete-button';

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
    select: { id: true, product: { select: { title: true, course: { select: { id: true } } } } },
  });
  if (!enrollment?.product.course) notFound();

  // The whole ordered material list, used for the viewer and for prev/next.
  const modules = await db.courseModule.findMany({
    where: { courseId: enrollment.product.course.id },
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

  const ordered = modules.flatMap((cm) => cm.module.sections.flatMap((s) => s.materials));
  const index = ordered.findIndex((m) => m.id === materialId);
  if (index === -1) notFound();

  const material = ordered[index];
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index < ordered.length - 1 ? ordered[index + 1] : null;

  const progress = await db.materialProgress.findUnique({
    where: { userId_materialId: { userId: user.id, materialId } },
    select: { completedAt: true },
  });

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/learn/${productId}`} className="t-small faint hover:underline">
          {enrollment.product.title}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{material.title}</h1>
        <p className="t-small faint">
          {MATERIAL_LABELS[material.type] ?? material.type}
          {material.durationSeconds ? ` · ${formatDuration(material.durationSeconds)}` : ''}
          {` · ${index + 1} of ${ordered.length}`}
        </p>
      </div>

      <MaterialViewer
        type={material.type}
        title={material.title}
        assetId={material.assetId}
        isDownloadable={material.isDownloadable}
        externalUrl={material.externalUrl}
        bodyHtml={material.bodyHtml}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {prev && (
            <Link
              href={`/learn/${productId}/${prev.id}`}
              className="rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2 text-sm"
            >
              Previous
            </Link>
          )}
          {next && (
            <Link
              href={`/learn/${productId}/${next.id}`}
              className="rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2 text-sm"
            >
              Next
            </Link>
          )}
        </div>

        <CompleteButton
          productId={productId}
          materialId={materialId}
          done={Boolean(progress?.completedAt)}
          nextHref={next ? `/learn/${productId}/${next.id}` : `/learn/${productId}`}
        />
      </div>
    </div>
  );
}
