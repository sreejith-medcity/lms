import { db } from '@/lib/db';
import { readUrlFor, storageConfigured } from '@/lib/storage';

/**
 * The banner strip.
 *
 * Server-rendered with a read URL minted per request rather than a link through
 * /api/assets, because that route asks whether the viewer is entitled to the
 * file and a banner is aimed at people who are not entitled to anything yet.
 *
 * Only the first active banner is shown. A stack of four is wallpaper: the
 * ordering on the admin screen exists so somebody has to decide which message
 * matters this week.
 */
export async function Banners({
  organizationId,
  placement,
  className = '',
}: {
  organizationId: string;
  placement: 'LEARNER_HOME' | 'SITE_HOME' | 'CATALOGUE';
  className?: string;
}) {
  if (!storageConfigured()) return null;

  const banner = await db.banner.findFirst({
    where: { organizationId, placement, isActive: true, imageAssetId: { not: null } },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, linkUrl: true, imageAssetId: true },
  });
  if (!banner?.imageAssetId) return null;

  const asset = await db.asset.findFirst({
    where: { id: banner.imageAssetId, organizationId, deletedAt: null },
    select: { storageKey: true },
  });
  if (!asset) return null;

  const src = readUrlFor(asset.storageKey, { expiresIn: 3600 });

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={banner.name}
      className="w-full rounded-[var(--radius)] object-cover"
      loading="lazy"
    />
  );

  return (
    <div className={className}>
      {banner.linkUrl ? (
        <a href={banner.linkUrl} className="block transition hover:brightness-95">
          {image}
        </a>
      ) : (
        image
      )}
    </div>
  );
}
