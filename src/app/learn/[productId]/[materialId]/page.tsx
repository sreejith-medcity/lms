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

      <Viewer
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

function Viewer({
  type,
  title,
  assetId,
  isDownloadable,
  externalUrl,
  bodyHtml,
}: {
  type: string;
  title: string;
  assetId: string | null;
  isDownloadable: boolean;
  externalUrl: string | null;
  bodyHtml: string | null;
}) {
  // Uploaded files are served through /api/assets, which checks the enrolment and
  // then hands out a five-minute signed link. The bucket itself stays private, so
  // a shared URL is dead within the hour.
  if (assetId) {
    const src = `/api/assets/${assetId}`;

    if (type === 'VIDEO') {
      return (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-[var(--radius)] border bg-black">
            <video src={src} controls playsInline controlsList="nodownload" className="aspect-video w-full">
              Your browser cannot play this video.
            </video>
          </div>
          {isDownloadable && <DownloadLink href={`${src}?download=1`} />}
        </div>
      );
    }

    if (type === 'AUDIO') {
      return (
        <Card>
          <audio src={src} controls className="w-full">
            Your browser cannot play this audio.
          </audio>
          {isDownloadable && <div className="mt-3"><DownloadLink href={`${src}?download=1`} /></div>}
        </Card>
      );
    }

    if (type === 'PDF' || type === 'EPUB') {
      return (
        <div className="space-y-2">
          <iframe
            src={src}
            title={title}
            className="h-[70vh] w-full rounded-[var(--radius)] border bg-[var(--surface)]"
          />
          {isDownloadable && <DownloadLink href={`${src}?download=1`} />}
        </div>
      );
    }

    if (type === 'IMAGE') {
      return (
        <div className="overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={title} className="mx-auto max-h-[70vh] w-auto" />
        </div>
      );
    }

    // Office documents and archives have no in-browser viewer worth trusting.
    return (
      <Card>
        <p className="t-small muted">
          {MATERIAL_LABELS[type] ?? 'This file'} opens outside the player.
        </p>
        <div className="mt-3 flex gap-2">
          <a
            href={src}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-white"
            style={{ background: 'var(--brand)' }}
          >
            Open
          </a>
          {isDownloadable && <DownloadLink href={`${src}?download=1`} />}
        </div>
      </Card>
    );
  }

  if (type === 'YOUTUBE' && externalUrl) {
    const embed = toYouTubeEmbed(externalUrl);
    if (embed) {
      return (
        <div className="aspect-video overflow-hidden rounded-[var(--radius)] border bg-black">
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
        <p className="t-small muted">This material lives outside the platform.</p>
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-white"
          style={{ background: 'var(--brand)' }}
        >
          Open {MATERIAL_LABELS[type] ?? 'material'}
        </a>
      </Card>
    );
  }

  return (
    <Card>
      <p className="t-small muted">Nothing is attached to this material yet.</p>
    </Card>
  );
}

function DownloadLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="inline-flex rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2 text-sm font-medium"
    >
      Download
    </a>
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
