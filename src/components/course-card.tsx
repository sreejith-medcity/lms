import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import {
  courseHighlights,
  materialCount,
  metaLine,
  savingPercent,
  type CourseCard as Card,
} from '@/lib/site';
import { CourseMedia } from '@/components/course-media';
import { AddonToggle } from '@/components/addon-toggle';
import { GoogleBadge } from '@/components/review-badge';
import { Rating } from '@/components/rating';

/**
 * One course, as a card.
 *
 * Two deliberate departures from the card this replaces. The whole card is no
 * longer one big link: a buyer browsing a catalogue wants two different things
 * from a card, to read more or to enrol, and a single link forces the second
 * through the first. And artwork now leads, because a wall of text cards is
 * how a catalogue of sixty courses becomes unreadable.
 *
 * Everything on it is read from the course. There is no field here an
 * institute can fill in with a claim the course does not support.
 */
export function CourseCard({
  card,
  rating,
  addon,
  google,
  priority = false,
}: {
  card: Card;
  rating?: { average: number; count: number };
  /** The academy's own Google rating, read once for the whole grid. */
  google?: { rating: string; reviewCount: string };
  /** The one extra worth offering from a card. More than one belongs on the page. */
  addon?: { productId: string; label: string; priceLabel: string };
  priority?: boolean;
}) {
  const plan = card.pricingPlans[0];
  const batch = card.course?.batches[0];
  const category = card.course?.categories[0]?.category;
  const saving = savingPercent(plan);
  const highlights = courseHighlights(card);
  const href = `/course/${card.slug}`;
  const lessons = materialCount(card);

  return (
    <article
      className="lift group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border
        bg-[var(--surface)] shadow-sm"
    >
      <Link href={href} tabIndex={-1} aria-hidden className="block">
        <CourseMedia title={card.title} assetId={card.course?.thumbnailAssetId} priority={priority} />
      </Link>

      <div className="flex flex-1 flex-col gap-2.5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {category && (
            <span className="t-eyebrow" style={{ color: 'var(--brand)' }}>
              {category.name}
            </span>
          )}
          {card.isFeatured && (
            <span
              className="t-eyebrow rounded-full px-2 py-0.5"
              style={{ background: 'var(--accent-soft)', color: 'var(--warn)' }}
            >
              Popular
            </span>
          )}
        </div>

        <h3 className="t-card-title">
          <Link href={href} className="transition group-hover:text-[var(--brand)]">
            {card.title}
          </Link>
        </h3>

        <p className="t-small faint">{metaLine(card)}</p>

        {rating ? (
          <Rating average={rating.average} count={rating.count} />
        ) : (
          google && <GoogleBadge rating={google.rating} reviewCount={google.reviewCount} compact />
        )}

        {card.course?.description && (
          <p className="t-small muted line-clamp-2 leading-relaxed">{card.course.description}</p>
        )}

        <ul className="mt-0.5 space-y-1.5">
          {highlights.map((h) => (
            <li key={h} className="t-small flex items-start gap-2">
              <Check />
              <span className="muted">{h}</span>
            </li>
          ))}
        </ul>

        {/* Everything above this line grows. Price and buttons sit on the
            baseline of every card in the row, whatever the title wrapped to. */}
        <div className="mt-auto pt-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {plan ? (
              <>
                <span className="text-lg font-bold tabular-nums">
                  {formatMoney(plan.pricePaise, plan.currency)}
                </span>
                {plan.mrpPaise && plan.mrpPaise > plan.pricePaise && (
                  <span className="t-small faint line-through tabular-nums">
                    {formatMoney(plan.mrpPaise, plan.currency)}
                  </span>
                )}
                {saving && (
                  <span
                    className="t-small rounded-full px-1.5 py-0.5 font-semibold"
                    style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}
                  >
                    {saving}% off
                  </span>
                )}
              </>
            ) : (
              <span className="text-lg font-bold">Price on enquiry</span>
            )}
          </div>

          <p className="t-small faint mt-0.5">
            {plan ? 'plus applicable taxes' : 'Talk to us about this course'}
            {batch?.startDate
              ? ` · next batch ${batch.startDate.toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                })}`
              : lessons > 0
                ? ' · start today'
                : ''}
          </p>

          <div className="mt-3.5">
            {addon ? (
              <AddonToggle
                href={href}
                addonProductId={addon.productId}
                label={addon.label}
                priceLabel={addon.priceLabel}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href={href}
                  className="inline-flex h-10 items-center justify-center rounded-[var(--radius-sm)] border
                    bg-[var(--surface)] px-3 text-sm font-medium transition
                    hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  Details
                </Link>
                <Link
                  href={`${href}#enrol`}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[var(--radius-sm)]
                    px-3 text-sm font-semibold transition hover:brightness-105"
                  style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                >
                  Enrol now
                  <span aria-hidden>→</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="mt-[0.2rem] h-3.5 w-3.5 shrink-0">
      <path
        d="M2 8.6l4 4L14 4"
        fill="none"
        stroke="var(--brand)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
