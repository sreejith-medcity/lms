import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { MATERIAL_LABELS, formatDuration } from '@/lib/progress';
import { Card } from '@/components/ui';
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
        <Link href={`/learn/${productId}`} className="text-sm text-slate-500 hover:underline">
          {enrollment.product.title}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{material.title}</h1>
        <p className="text-sm text-slate-500">
          {MATERIAL_LABELS[material.type] ?? material.type}
          {material.durationSeconds ? ` · ${formatDuration(material.durationSeconds)}` : ''}
          {` · ${index + 1} of ${ordered.length}`}
        </p>
      </div>

      <Viewer
        type={material.type}
        title={material.title}
        externalUrl={material.externalUrl}
        bodyHtml={material.bodyHtml}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {prev && (
            <Link
              href={`/learn/${productId}/${prev.id}`}
              className="rounded-lg border bg-white px-3 py-2 text-sm"
            >
              Previous
            </Link>
          )}
          {next && (
            <Link
              href={`/learn/${productId}/${next.id}`}
              className="rounded-lg border bg-white px-3 py-2 text-sm"
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

function Viewer({
  type,
  title,
  externalUrl,
  bodyHtml,
}: {
  type: string;
  title: string;
  externalUrl: string | null;
  bodyHtml: string | null;
}) {
  if (type === 'YOUTUBE' && externalUrl) {
    const embed = toYouTubeEmbed(externalUrl);
    if (embed) {
      return (
        <div className="aspect-video overflow-hidden rounded-xl border bg-black">
          <iframe
            src={embed}
            title={title}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      );
    }
  }

  if (type === 'TEXT_HTML' && bodyHtml) {
    // Authored by staff inside the admin, not by learners.
    return (
      <Card>
        <div className="prose prose-slate max-w-none text-sm" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </Card>
    );
  }

  if (externalUrl) {
    return (
      <Card>
        <p className="text-sm text-slate-600">This material lives outside the platform.</p>
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex rounded-lg px-3 py-2 text-sm font-medium text-white"
          style={{ background: 'var(--brand)' }}
        >
          Open {MATERIAL_LABELS[type] ?? 'material'}
        </a>
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm text-slate-600">
        No file is attached yet. Uploads arrive with the asset library, and this material will play
        here once it does.
      </p>
    </Card>
  );
}

function toYouTubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return `https://www.youtube-nocookie.com/embed${u.pathname}`;
    if (u.hostname.endsWith('youtube.com')) {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
      if (u.pathname.startsWith('/embed/')) return `https://www.youtube-nocookie.com${u.pathname}`;
    }
  } catch {
    return null;
  }
  return null;
}
