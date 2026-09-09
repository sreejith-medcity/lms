import { MATERIAL_LABELS } from '@/lib/progress';
import { Card } from '@/components/ui';

/**
 * One renderer for course material, shared by the enrolled player and the public
 * sample lesson. Uploaded files are served through /api/assets, which checks the
 * viewer's entitlement and only then hands out a short-lived link.
 */
export function MaterialViewer({
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
