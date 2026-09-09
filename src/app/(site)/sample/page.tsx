import Link from 'next/link';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { MATERIAL_LABELS, formatDuration } from '@/lib/progress';
import { MaterialViewer } from '@/components/material-viewer';
import { NoTenantNotice } from '@/components/tenant-notices';
import { EmptyState, LinkButton } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sample lesson',
  description: 'A real lesson from a published course, playable without an account.',
  alternates: { canonical: '/sample' },
};

/**
 * A real lesson, not a marketing video. It is whichever material a course has
 * flagged as a free preview, so what a visitor sees here is exactly what a
 * learner gets. /api/assets already treats a free-preview material as public,
 * which is why this works without a session.
 */
export default async function SamplePage() {
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;

  const material = await db.material.findFirst({
    where: {
      isFreePreview: true,
      section: { module: { organizationId: site.organizationId } },
    },
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
      section: {
        select: {
          title: true,
          module: {
            select: {
              name: true,
              courses: {
                take: 1,
                select: { course: { select: { product: { select: { title: true, slug: true } } } } },
              },
            },
          },
        },
      },
    },
  });

  if (!material) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <EmptyState
          title="No sample lesson is published yet"
          hint="A course can mark any lesson as a free preview, and it appears here."
          action={<LinkButton href="/courses">Browse courses</LinkButton>}
        />
      </div>
    );
  }

  const product = material.section.module.courses[0]?.course.product;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <p className="t-small faint">
        Sample lesson{product ? ` from ${product.title}` : ''}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{material.title}</h1>
      <p className="t-small faint mt-1">
        {material.section.module.name} · {material.section.title}
        {' · '}
        {MATERIAL_LABELS[material.type] ?? material.type}
        {material.durationSeconds ? ` · ${formatDuration(material.durationSeconds)}` : ''}
      </p>

      <div className="mt-6">
        <MaterialViewer
          type={material.type}
          title={material.title}
          assetId={material.assetId}
          isDownloadable={material.isDownloadable}
          externalUrl={material.externalUrl}
          bodyHtml={material.bodyHtml}
        />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border bg-[var(--surface)] p-5">
        <p className="t-small muted flex-1">
          This is one lesson from a full course. Enrolling gives you the rest, the live classes
          and your progress tracked across devices.
        </p>
        {product ? (
          <LinkButton href={`/course/${product.slug}`}>See the course</LinkButton>
        ) : (
          <LinkButton href="/courses">Browse courses</LinkButton>
        )}
      </div>
    </div>
  );
}
