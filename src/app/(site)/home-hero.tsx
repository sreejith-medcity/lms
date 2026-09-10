import Link from 'next/link';
import { GoogleBadge, ReviewWidget } from '@/components/review-badge';

/**
 * The band at the top of the home page.
 *
 * Built to the shape the WordPress storefront already proved: the words on
 * the left with one loud button under them, the photograph on the right in a
 * tilted frame with a caption card overlapping its corner, and a row of four
 * plain claims underneath. It works because each piece does one job, and
 * because the picture is a real photograph of the academy rather than stock.
 *
 * What is different here is that none of it is hardcoded. The words, the
 * script line, the caption and the four claims are all settings, because the
 * sentence that sells a German academy is not the one that sells a nursing
 * school and this platform carries both. The colours come from the tenant's
 * own brand token, so the same layout is green for one academy and purple for
 * another without a second stylesheet.
 *
 * Everything degrades: no photograph, no script line, no caption and no
 * claims still leaves a headline, a sentence and a button, correctly spaced.
 */

export interface HeroHighlight {
  label: string;
  detail: string;
}

/** Four small marks, in the order the claims are given. */
const ICONS = [
  // A lesson playing
  'M8 5.5v13l11-6.5z',
  // A sheet of questions
  'M6 3.5h9l3 3v14H6zM9 11h6M9 15h6M9 7.5h3',
  // Progress
  'M5 19V9M12 19V4M19 19v-7',
  // People
  'M7 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c0-2.5 1.8-4 3.5-4s3.5 1.5 3.5 4M16 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM13.5 19c0-2 1.2-3.5 2.5-3.5s2.5 1.5 2.5 3.5',
];

export function HomeHero({
  eyebrow,
  kicker,
  title,
  highlight,
  blurb,
  script,
  caption,
  highlights,
  imageAssetId,
  google,
  badgeHtml,
  sampleId,
}: {
  /** The pill above the headline: a launch, an intake, a piece of news. */
  eyebrow: string;
  /** The spaced-out line above the headline. */
  kicker: string;
  title: string;
  /** The second line, in the accent colour. Optional. */
  highlight: string;
  blurb: string;
  /** The handwritten line beside the photograph. Optional. */
  script: string;
  /** The card overlapping the photograph: a title and one line. Optional. */
  caption: { title: string; detail: string } | null;
  /** The row underneath. Up to four, or none. */
  highlights: HeroHighlight[];
  imageAssetId: string | null;
  google: { rating: string; reviewCount: string } | null;
  /** A provider's own badge widget. Takes the place of the plain one. */
  badgeHtml: string;
  sampleId: string | null;
}) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Two soft washes of the brand, well out of the way of the words. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `
            radial-gradient(38rem 26rem at 88% 8%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%),
            radial-gradient(34rem 24rem at 4% 82%, color-mix(in srgb, var(--brand) 12%, transparent), transparent 70%)`,
        }}
      />

      <div className="mx-auto grid max-w-[86rem] items-center gap-10 px-4 pb-4 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14 lg:pt-14">
        <div className="text-center lg:text-left">
          {eyebrow && (
            <p
              className="inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[0.8125rem] font-semibold"
              style={{
                background: 'color-mix(in srgb, var(--brand) 10%, var(--surface))',
                color: 'var(--ink)',
              }}
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: 'var(--brand)' }}
              />
              {eyebrow}
            </p>
          )}

          {kicker && (
            <p
              className="mt-6 text-[0.75rem] font-semibold uppercase leading-4"
              style={{ color: 'var(--ink-2)', letterSpacing: '0.28em' }}
            >
              {kicker}
            </p>
          )}

          <h1
            className="mt-3 text-[clamp(2rem,7.6vw,2.6rem)] font-[720] leading-[1.06] tracking-[-0.035em]
              lg:text-[clamp(2.6rem,3.6vw,3.5rem)]"
            style={{ color: 'var(--ink)', textWrap: 'balance' }}
          >
            {title}
            {highlight && (
              /* The readable amber, not the surface one: see --accent-strong. */
              <span className="mt-1.5 block" style={{ color: 'var(--accent-strong)' }}>
                {highlight}
              </span>
            )}
          </h1>

          <p
            className="mx-auto mt-5 max-w-[32rem] text-[0.9375rem] leading-[1.7] lg:mx-0 lg:text-base"
            style={{ color: 'var(--ink-2)' }}
          >
            {blurb}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 lg:justify-start">
            <Link
              href="/courses"
              className="inline-flex h-[3.25rem] items-center gap-3 rounded-full px-8 text-base font-bold
                transition hover:-translate-y-0.5 hover:brightness-[1.06] motion-reduce:hover:translate-y-0"
              style={{
                background: 'var(--brand)',
                color: 'var(--brand-ink)',
                boxShadow: '0 18px 34px -16px color-mix(in srgb, var(--brand) 65%, transparent)',
              }}
            >
              Explore courses
              <span aria-hidden>→</span>
            </Link>

            <Link
              href={sampleId ? '/sample' : '/contact'}
              className="text-[0.9375rem] font-semibold underline underline-offset-4"
              style={{ color: 'var(--ink-2)' }}
            >
              {sampleId ? 'Try a lesson first' : 'Talk to an advisor'}
            </Link>
          </div>

          {/* The provider's own badge if there is one, and the plain one
              otherwise. Not both: two review badges in one hero is an
              argument with itself. */}
          {badgeHtml.trim() ? (
            <div className="mt-7 flex justify-center lg:justify-start">
              <ReviewWidget html={badgeHtml} />
            </div>
          ) : (
            google && (
              <div className="mt-7 flex justify-center lg:justify-start">
                <GoogleBadge rating={google.rating} reviewCount={google.reviewCount} />
              </div>
            )
          )}
        </div>

        {imageAssetId ? (
          <div className="relative">
            {/* In the margin above the photograph rather than across it: over
                the picture it is unreadable on half the photographs an
                academy will upload, and it is decoration either way. */}
            {script && (
              <p
                aria-hidden
                className="script pointer-events-none mb-3 hidden text-right text-[1.9rem]
                  leading-[1.1] lg:block"
                style={{ color: 'color-mix(in srgb, var(--brand) 48%, var(--surface))' }}
              >
                {script}
                <svg viewBox="0 0 120 12" className="ml-auto mt-1 block h-3 w-28" fill="none" aria-hidden>
                  <path
                    d="M2 8c22-6 62-8 116-4"
                    stroke="var(--accent)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </p>
            )}

            <figure
              className="relative overflow-hidden rounded-[1.75rem] lg:rotate-[-1.4deg]"
              style={{
                boxShadow: '0 40px 70px -34px color-mix(in srgb, var(--ink) 55%, transparent)',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/assets/${imageAssetId}`}
                alt=""
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="aspect-[16/10] w-full object-cover object-center"
              />
            </figure>

            {caption && (
              /* Positioned even on a phone, where it only overlaps by a
                 little: the figure above it is positioned too, and without
                 this the card is painted underneath it. */
              <div
                className="relative z-10 mx-auto -mt-8 w-[min(22rem,92%)] rounded-[1.125rem]
                  bg-[var(--surface)] p-4 shadow-lg lg:absolute lg:-bottom-6 lg:right-4 lg:mx-0
                  lg:mt-0 lg:w-[19rem]"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                    style={{
                      background: 'color-mix(in srgb, var(--brand) 12%, var(--surface))',
                      color: 'var(--brand)',
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
                      <path
                        d={ICONS[3]}
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <p className="t-heading">{caption.title}</p>
                    {caption.detail && (
                      <p className="t-small muted mt-0.5 leading-relaxed">{caption.detail}</p>
                    )}
                    <span
                      aria-hidden
                      className="mt-2 block h-[3px] w-10 rounded-full"
                      style={{ background: 'var(--accent)' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {highlights.length > 0 && (
        <ul
          className="mx-auto mt-10 grid max-w-[86rem] grid-cols-2 gap-x-4 gap-y-6 px-4 pb-10
            sm:px-6 lg:mt-14 lg:grid-cols-4 lg:gap-0 lg:pb-14"
        >
          {highlights.slice(0, 4).map((item, i) => (
            <li
              key={item.label}
              /* Stacked on a phone, where two columns of icon-then-text put
                 one item's mark against the next item's words. Side by side
                 from the wide breakpoint, with a rule between them. */
              className={`flex flex-col items-start gap-2 lg:flex-row lg:items-center lg:gap-3
                lg:justify-center lg:px-6 ${i > 0 ? 'lg:border-l' : ''}`}
            >
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl lg:h-11 lg:w-11"
                style={{
                  background: 'color-mix(in srgb, var(--brand) 9%, var(--surface))',
                  color: 'var(--brand)',
                }}
              >
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none">
                  <path
                    d={ICONS[i % ICONS.length]}
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-[0.9375rem] font-bold leading-tight">{item.label}</span>
                {item.detail && <span className="t-small muted block">{item.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
