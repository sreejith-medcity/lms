import Link from 'next/link';
import { CourseMedia } from '@/components/course-media';
import { GoogleBadge } from '@/components/review-badge';

export interface Subject {
  name: string;
  slug: string;
  tagline: string | null;
  imageAssetId: string | null;
  ctaLabel: string | null;
  comingSoon: boolean;
  _count: { courses: number };
}

/**
 * One subject, as a card on the home page.
 *
 * The storefront this replaces leads with these rather than with individual
 * courses, and it is the right call for a catalogue this shape: somebody
 * arriving knows they want German or they want NCLEX, and showing them
 * sixty-five products first makes them do the sorting.
 *
 * A subject with nothing published behind it still gets a card, because
 * "coming soon" is information a visitor can act on, but it does not get a
 * link. A card that leads to an empty page is worse than one that says it is
 * not ready.
 *
 * The card has two shapes. On a phone it is a compact tile, two to a row:
 * artwork, name, course count, and nothing else, because ten full cards
 * stacked is a scroll nobody finishes and a sideways rail hides half the
 * subjects behind a gesture. From the small breakpoint up it fills out with
 * the tagline, the rating and its own button. The whole card is the link in
 * both shapes, so on a phone there is no small target to hit.
 */
export function SubjectCard({
  subject,
  google,
  priority = false,
}: {
  subject: Subject;
  /** The academy's own Google rating, read once for the whole grid. */
  google?: { rating: string; reviewCount: string };
  priority?: boolean;
}) {
  const href = `/courses/${subject.slug}`;
  const count = subject._count.courses;

  return (
    <article
      className={`relative flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] border
        bg-[var(--surface)] shadow-sm ${subject.comingSoon ? '' : 'lift'}`}
    >
      <CourseMedia
        title={subject.name}
        assetId={subject.imageAssetId}
        ratio="aspect-[16/9]"
        priority={priority}
        className={subject.comingSoon ? '[&>img]:saturate-[0.78] [&>img]:contrast-[0.94]' : ''}
      />

      <div className="flex flex-1 flex-col p-3 sm:p-5">
        <h3 className="t-card-title line-clamp-3 sm:min-h-[2.7em]">
          {subject.comingSoon ? (
            subject.name
          ) : (
            /* The pseudo-element stretches this link over the whole card, so a
               tap anywhere on the tile goes to the subject. The button below
               is lifted above it so it keeps its own hover and focus ring. */
            <Link
              href={href}
              className="transition after:absolute after:inset-0 after:content-['']
                hover:text-[var(--brand)]"
            >
              {subject.name}
            </Link>
          )}
        </h3>

        {subject.tagline && (
          <div className="hidden sm:block">
            <p className="t-small muted mt-2 line-clamp-3 leading-relaxed">{subject.tagline}</p>
          </div>
        )}

        {google && (
          <div className="hidden sm:block">
            <GoogleBadge
              rating={google.rating}
              reviewCount={google.reviewCount}
              compact
              className="mt-3"
            />
          </div>
        )}

        {!subject.comingSoon && count > 0 && (
          <p className="t-small faint mt-1.5 tabular-nums sm:mt-2">
            {count} course{count === 1 ? '' : 's'}
          </p>
        )}

        {/* The button is the last thing in the card, always. It used to have
            the course count underneath it, which meant a card with courses
            put its button thirty pixels higher than a coming-soon card beside
            it, and a row of five read as a staircase.

            On a phone it is gone entirely: the card is already the link, and
            a full-width purple bar in every one of ten tiles is noise, not
            navigation. "Coming soon" stays at every width, because that one
            is information rather than a control. */}
        {subject.comingSoon ? (
          <div className="mt-auto pt-3 sm:pt-5">
            <span
              className="t-eyebrow inline-flex w-full items-center justify-center
                rounded-[var(--radius-sm)] border border-dashed px-2 py-1.5 text-center
                sm:min-h-[3.25rem] sm:px-3 sm:py-2"
              style={{ color: 'var(--ink-2)' }}
            >
              Coming soon
            </span>
          </div>
        ) : (
          <div className="relative z-10 mt-auto hidden pt-5 sm:block">
            <Link
              href={href}
              tabIndex={-1}
              // A fixed minimum rather than a fixed height, so a label that
              // needs two lines gets them and still occupies the same box as
              // a one-line label beside it. Truncating was worse than
              // wrapping: "Browse German ..." tells a reader nothing.
              className="inline-flex min-h-[3.25rem] w-full items-center justify-center gap-2
                rounded-[var(--radius-sm)] px-3 py-2 text-center text-[0.8125rem] font-semibold
                leading-tight text-[var(--brand-ink)] transition hover:brightness-110"
              style={{ background: 'var(--brand)' }}
            >
              <span>{subject.ctaLabel?.trim() || `Browse ${subject.name}`}</span>
              <span aria-hidden className="shrink-0">
                →
              </span>
            </Link>
          </div>
        )}
      </div>
    </article>
  );
}
