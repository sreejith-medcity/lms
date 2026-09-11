import Link from 'next/link';
import { GoogleBadge, ReviewWidget } from '@/components/review-badge';

/**
 * The band at the top of the home page.
 *
 * Restraint is the whole design here. The first version carried a pill, a
 * grid, a glow, a counter row and two gradients, and the effect of stacking
 * five devices is that none of them reads as deliberate. What is left is a
 * headline, a sentence, two buttons and one piece of evidence, on a panel
 * with a photograph blended into it. Everything that survived is doing work.
 *
 * The counters went for a second reason as well as visual noise: a storefront
 * announcing "1 course published" is telling a visitor how empty it is. A
 * number belongs on a page when it is an argument, and until the catalogue is
 * migrated this one argues against us.
 *
 * The words are settings, because the sentence that sells a German academy is
 * not the one that sells a nursing school and this platform carries both. The
 * photograph is optional and the layout does not lean on it.
 */
export function HomeHero({
  eyebrow,
  title,
  highlight,
  blurb,
  imageAssetId,
  google,
  badgeHtml,
  badgeOnLight,
  sampleId,
}: {
  /** Usually empty. Kept for an academy running a launch or an intake. */
  eyebrow: string;
  title: string;
  /** The second line, in amber. Optional: a one-line headline is fine. */
  highlight: string;
  blurb: string;
  imageAssetId: string | null;
  google: { rating: string; reviewCount: string } | null;
  /** A provider's own badge widget. Takes the place of the plain one. */
  badgeHtml: string;
  /** True when that badge writes in dark text and needs a light background. */
  badgeOnLight: boolean;
  sampleId: string | null;
}) {
  return (
    <section className="mx-auto max-w-[86rem] px-3 pt-3 sm:px-4 sm:pt-4">
      <div
        className="relative isolate overflow-hidden rounded-[1.125rem] sm:rounded-[1.5rem]"
        style={{
          background: `
            radial-gradient(120% 90% at 8% 100%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 55%),
            linear-gradient(115deg, var(--shell) 0%, var(--shell) 52%, color-mix(in srgb, var(--shell) 78%, var(--ink-2)) 100%)`,
          boxShadow:
            '0 28px 70px -30px color-mix(in srgb, var(--shell) 62%, transparent), inset 0 1px 0 color-mix(in srgb, var(--shell-ink) 10%, transparent)',
        }}
      >
        <div
          className={`relative z-10 flex flex-col justify-center px-6 pb-9 pt-10 text-center sm:px-9
            lg:min-h-[33rem] lg:py-14 lg:pl-[clamp(2.5rem,4.5vw,4rem)] lg:pr-8 lg:text-left
            ${imageAssetId ? 'lg:w-[60%]' : 'lg:w-[74%]'}`}
        >
          {eyebrow && (
            <p
              className="t-eyebrow mb-5 flex items-center justify-center gap-2.5 lg:justify-start"
              style={{ color: 'var(--accent)' }}
            >
              <span aria-hidden className="hidden h-px w-6 bg-current lg:block" />
              {eyebrow}
            </p>
          )}

          <h1
            className="text-[clamp(1.9rem,7.2vw,2.4rem)] font-[720] leading-[1.08] tracking-[-0.035em]
              lg:text-[clamp(2.4rem,3.2vw,3.05rem)]"
            style={{ color: 'var(--shell-ink)', textWrap: 'balance' }}
          >
            {title}
            {highlight && (
              <span className="mt-2 block" style={{ color: 'var(--accent)' }}>
                {highlight}
              </span>
            )}
          </h1>

          <p
            className="mx-auto mt-5 max-w-[34rem] text-[0.9375rem] leading-[1.7] lg:mx-0 lg:text-base"
            style={{ color: 'var(--shell-muted)' }}
          >
            {blurb}
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
            <Link
              href="/courses"
              className="inline-flex h-12 items-center gap-2.5 rounded-[0.625rem] px-7 text-[0.9375rem] font-bold
                transition hover:-translate-y-0.5 hover:brightness-[1.04] motion-reduce:hover:translate-y-0"
              style={{
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
                boxShadow: '0 14px 30px -12px color-mix(in srgb, var(--shell) 70%, transparent)',
              }}
            >
              Explore courses
              <span aria-hidden>→</span>
            </Link>
            <Link
              href={sampleId ? '/sample' : '/contact'}
              className="inline-flex h-12 items-center rounded-[0.625rem] border px-6 text-[0.9375rem] font-semibold
                transition hover:bg-white/[0.07]"
              style={{ borderColor: 'var(--shell-line)', color: 'var(--shell-ink)' }}
            >
              {sampleId ? 'Try a lesson first' : 'Talk to an advisor'}
            </Link>
          </div>

          {/* The provider's own badge if there is one, and the plain one
              otherwise. Not both: two review badges in one hero is an
              argument with itself. */}
          {badgeHtml.trim() ? (
            <div className="mt-7 flex justify-center lg:justify-start">
              {/*
                A provider's badge arrives with its own colours, and only the
                academy knows which it chose. One Trustindex badge paints its
                text pure black, which is 1.43:1 on this purple panel; another
                paints it white, which is invisible on a white chip. Both have
                happened here, a week apart, which is why the background is a
                setting rather than a guess: the badge is put on the ground it
                was designed for instead of arguing with its stylesheet.
              */}
              {badgeOnLight ? (
                <span className="inline-flex max-w-full items-center rounded-full bg-[var(--surface)] px-3 py-1.5 shadow-sm">
                  <ReviewWidget html={badgeHtml} />
                </span>
              ) : (
                <ReviewWidget html={badgeHtml} />
              )}
            </div>
          ) : (
            google && (
              <div className="mt-7 flex justify-center lg:justify-start">
                <GoogleBadge
                  rating={google.rating}
                  reviewCount={google.reviewCount}
                  onDark
                  className="border-[var(--shell-line)] bg-[color-mix(in_srgb,var(--shell)_55%,transparent)] backdrop-blur"
                />
              </div>
            )
          )}
        </div>

        {imageAssetId && (
          <>
            {/*
              Rendered after the words on purpose. On a phone the picture is
              the lower half of the panel, which is where it belongs: a
              stranger should meet the sentence before the photograph. On a
              wide screen it is taken out of the flow and fills the right, so
              the order stops mattering.
            */}
            <div
              aria-hidden
              className="pointer-events-none relative z-[1] -mx-1 -mb-1 mt-2 lg:absolute lg:inset-y-0 lg:right-0 lg:m-0 lg:w-[54%]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/assets/${imageAssetId}`}
                alt=""
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="hero-photo h-full w-full object-cover object-center"
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
