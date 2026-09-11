import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import {
  courseHighlights,
  learningFormat,
  materialCount,
  savingPercent,
  type CourseCard as Card,
} from '@/lib/site';
import { CourseMedia } from '@/components/course-media';
import { AddonToggle } from '@/components/addon-toggle';
import { Rating } from '@/components/rating';

/**
 * One course, as a card, in the shape every course marketplace has settled
 * on: picture, title, a line of facts, stars, price. Nothing else, because
 * a row of five of these has to be readable at a glance and a card is a
 * promise of a page, not the page.
 *
 * The whole card is the link. Everything on it is read from the course, so
 * a card cannot claim a duration or a rating the course does not have.
 */

export interface RatingSummary {
  average: number;
  count: number;
}

export function CourseCard({
  card,
  rating,
  google,
  addon,
  priority = false,
  compact = false,
}: {
  card: Card;
  rating?: RatingSummary;
  /** The academy's own Google rating, shown where a course has none of its own. */
  google?: { rating: string; reviewCount: string };
  /** The one extra worth offering from a card. More than one belongs on the page. */
  addon?: { productId: string; label: string; priceLabel: string };
  priority?: boolean;
  /** A rail card: fixed width, tighter. */
  compact?: boolean;
}) {
  const plan = card.pricingPlans[0];
  const batch = card.course?.batches[0];
  const saving = savingPercent(plan);
  const href = `/course/${card.slug}`;

  return (
    <article className={`group relative flex h-full flex-col ${compact ? 'w-[15.5rem] shrink-0 sm:w-[17rem]' : ''}`}>
      <Link href={href} className="block overflow-hidden rounded-[var(--radius-sm)] border">
        <CourseMedia title={card.title} assetId={card.course?.thumbnailAssetId} priority={priority} ratio="aspect-video" />
      </Link>

      <div className="flex flex-1 flex-col pt-2.5">
        <h3 className="text-[0.9375rem] font-bold leading-snug line-clamp-2">
          <Link href={href} className="after:absolute after:inset-0 group-hover:text-[var(--brand)]">
            {card.title}
          </Link>
        </h3>

        <p className="t-small faint mt-1 line-clamp-1">{factLine(card)}</p>

        <div className="mt-1 min-h-[1.25rem]">
          {rating ? (
            <Rating average={rating.average} count={rating.count} />
          ) : google ? (
            <span className="t-small inline-flex items-center gap-1.5">
              <span className="font-semibold tabular-nums" style={{ color: 'var(--warn)' }}>
                {google.rating}
              </span>
              <Stars value={Number(google.rating) || 5} />
              <span className="faint whitespace-nowrap tabular-nums">({google.reviewCount}<span className="hidden sm:inline"> on Google</span>)</span>
            </span>
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
          {plan ? (
            <>
              <span className="font-bold tabular-nums">{formatMoney(plan.pricePaise, plan.currency)}</span>
              {plan.mrpPaise && plan.mrpPaise > plan.pricePaise && (
                <span className="t-small faint line-through tabular-nums">{formatMoney(plan.mrpPaise, plan.currency)}</span>
              )}
              {saving && <span className="t-small font-semibold" style={{ color: 'var(--ok)' }}>{saving}% off</span>}
            </>
          ) : (
            <span className="font-bold">Price on enquiry</span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.isFeatured && <Tag tone="gold">Popular</Tag>}
          {batch && (
            <Tag tone="plain">
              {batch.startDate
                ? `Batch ${batch.startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : 'Live batch'}
            </Tag>
          )}
          {(plan?.instalmentCount ?? 0) > 1 && <Tag tone="plain">Instalments</Tag>}
        </div>

        {addon && (
          <div className="relative z-10 mt-3">
            <AddonToggle href={href} addonProductId={addon.productId} label={addon.label} priceLabel={addon.priceLabel} />
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * The same course as a wide row, for the catalogue: picture left, the facts
 * and what you get in the middle, the price on the right. This is where the
 * three highlights earn their place, because a list is read more slowly
 * than a rail.
 */
export function CourseListRow({
  card,
  rating,
  google,
  priority = false,
}: {
  card: Card;
  rating?: RatingSummary;
  google?: { rating: string; reviewCount: string };
  priority?: boolean;
}) {
  const plan = card.pricingPlans[0];
  const saving = savingPercent(plan);
  const href = `/course/${card.slug}`;
  const highlights = courseHighlights(card);
  const category = card.course?.categories[0]?.category;

  return (
    <article className="group relative flex gap-4 border-b py-5 last:border-b-0 sm:gap-5">
      <Link href={href} className="block w-28 shrink-0 self-start overflow-hidden rounded-[var(--radius-sm)] border sm:w-64">
        <CourseMedia title={card.title} assetId={card.course?.thumbnailAssetId} priority={priority} ratio="aspect-video" />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold leading-snug sm:text-lg">
              <Link href={href} className="after:absolute after:inset-0 group-hover:text-[var(--brand)]">
                {card.title}
              </Link>
            </h3>
            {card.course?.description && (
              <p className="t-small muted mt-1 hidden line-clamp-2 sm:block">{card.course.description}</p>
            )}
          </div>
          <div className="hidden shrink-0 text-right sm:block">
            {plan ? (
              <>
                <p className="font-bold tabular-nums">{formatMoney(plan.pricePaise, plan.currency)}</p>
                {plan.mrpPaise && plan.mrpPaise > plan.pricePaise && (
                  <p className="t-small faint line-through tabular-nums">{formatMoney(plan.mrpPaise, plan.currency)}</p>
                )}
              </>
            ) : (
              <p className="font-bold">On enquiry</p>
            )}
          </div>
        </div>

        <p className="t-small faint mt-1.5">
          {category ? `${category.name} · ` : ''}
          {factLine(card)}
        </p>

        <div className="mt-1 min-h-[1.25rem]">
          {rating ? (
            <Rating average={rating.average} count={rating.count} />
          ) : google ? (
            <span className="t-small inline-flex items-center gap-1.5">
              <span className="font-semibold tabular-nums" style={{ color: 'var(--warn)' }}>{google.rating}</span>
              <Stars value={Number(google.rating) || 5} />
              <span className="faint whitespace-nowrap">({google.reviewCount}<span className="hidden sm:inline"> on Google</span>)</span>
            </span>
          ) : null}
        </div>

        <ul className="t-small muted mt-2 hidden flex-wrap gap-x-4 gap-y-1 sm:flex">
          {highlights.map((h) => (
            <li key={h} className="flex items-center gap-1.5">
              <Check />
              {h}
            </li>
          ))}
        </ul>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:hidden">
          {plan && <span className="font-bold tabular-nums">{formatMoney(plan.pricePaise, plan.currency)}</span>}
          {saving && <span className="t-small font-semibold" style={{ color: 'var(--ok)' }}>{saving}% off</span>}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.isFeatured && <Tag tone="gold">Popular</Tag>}
          {saving && <Tag tone="plain" className="hidden sm:inline-flex">{saving}% off</Tag>}
        </div>
      </div>
    </article>
  );
}

/** Format, hours, lessons, level: the facts, all read from the course. */
function factLine(card: Card): string {
  const parts: string[] = [learningFormat(card)];
  const minutes = card.course?.durationMinutes ?? 0;
  if (minutes > 0) parts.push(minutes >= 90 ? `${Math.round(minutes / 60)} hours` : `${minutes} min`);
  const lessons = materialCount(card);
  if (lessons > 0) parts.push(`${lessons} lesson${lessons === 1 ? '' : 's'}`);
  if (card.course?.level) parts.push(card.course.level);
  return parts.join(' · ');
}

function Tag({ children, tone, className = '' }: { children: React.ReactNode; tone: 'gold' | 'plain'; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-[0.6875rem] font-bold ${className}`}
      style={
        tone === 'gold'
          ? { background: 'var(--accent)', color: 'var(--accent-ink)' }
          : { background: 'var(--surface-2)', color: 'var(--ink-2)' }
      }
    >
      {children}
    </span>
  );
}

function Stars({ value }: { value: number }) {
  const rounded = Math.round(Math.min(5, Math.max(0, value)) * 2) / 2;
  return (
    <span aria-hidden className="inline-flex" style={{ color: 'var(--accent)' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} viewBox="0 0 20 20" className="h-3.5 w-3.5">
          <path
            d="M10 1.8l2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.7l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z"
            fill={rounded >= n ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      ))}
    </span>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 shrink-0">
      <path d="M2 8.6l4 4L14 4" fill="none" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
