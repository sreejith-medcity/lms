import Link from 'next/link';
import { CourseMedia } from '@/components/course-media';
import { formatMoney } from '@/lib/money';
import type { BundleCardData } from '@/lib/bundles-data';

/**
 * A bundle on the catalogue. It looks like a course card so the eye reads
 * it as one thing to buy, and says what is inside and what is saved, which
 * are the two facts a bundle exists to communicate.
 */
export function BundleCard({ bundle, priority = false }: { bundle: BundleCardData; priority?: boolean }) {
  const href = `/bundle/${bundle.slug}`;
  return (
    <article className="group relative flex h-full flex-col">
      <Link href={href} className="block overflow-hidden rounded-[var(--radius-sm)] border">
        <CourseMedia title={bundle.title} assetId={bundle.thumbnailAssetId} priority={priority} ratio="aspect-video" />
      </Link>
      <div className="flex flex-1 flex-col pt-2.5">
        <h3 className="text-[0.9375rem] font-bold leading-snug line-clamp-2">
          <Link href={href} className="after:absolute after:inset-0 group-hover:text-[var(--brand)]">
            {bundle.title}
          </Link>
        </h3>
        <p className="t-small faint mt-1 line-clamp-1">
          Bundle · {bundle.courseTitles.length} courses: {bundle.courseTitles.join(', ')}
        </p>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
          {bundle.pricePaise !== null ? (
            <>
              <span className="font-bold tabular-nums">{formatMoney(bundle.pricePaise, bundle.currency)}</span>
              {bundle.saving.savingPaise > 0 && (
                <>
                  <span className="t-small faint line-through tabular-nums">{formatMoney(bundle.saving.separatelyPaise, bundle.currency)}</span>
                  <span className="t-small font-semibold" style={{ color: 'var(--ok)' }}>
                    Save {bundle.saving.savingPercent}%
                  </span>
                </>
              )}
            </>
          ) : (
            <span className="font-bold">Price on enquiry</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="t-micro rounded-full px-2 py-0.5 font-bold" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            Bundle
          </span>
          {bundle.isFeatured && (
            <span className="t-micro rounded-full px-2 py-0.5 font-bold" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
              Popular
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
