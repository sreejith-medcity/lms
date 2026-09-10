import Link from 'next/link';
import { GoogleBadge } from '@/components/review-badge';

/**
 * The band at the top of the home page.
 *
 * Rebuilt from the hero already running on the WordPress site, so the two
 * look like one company while both are live: the purple panel, the amber
 * accent line in the headline, the photograph dissolving into the panel
 * rather than sitting in a rectangle, and the glass review badge.
 *
 * Three things are done differently on purpose.
 *
 * The words are settings rather than markup, because the sentence that sells
 * a German academy is not the sentence that sells a nursing one, and this
 * platform is meant to carry both.
 *
 * The photograph is optional and the layout does not depend on it. An academy
 * setting this up on day one has no launch photo, and a hero with a hole in
 * it is worse than a hero without a picture.
 *
 * The numbers underneath are counted, not typed. A storefront claiming "500+
 * courses" with nothing behind it is the thing this product is replacing.
 */
export function HomeHero({
  eyebrow,
  title,
  highlight,
  blurb,
  imageAssetId,
  google,
  facts,
  sampleId,
}: {
  eyebrow: string;
  title: string;
  /** The second line, in amber. Optional: a one-line headline is fine. */
  highlight: string;
  blurb: string;
  imageAssetId: string | null;
  google: { rating: string; reviewCount: string } | null;
  facts: { label: string; value: string }[];
  sampleId: string | null;
}) {
  return (
    <section className="mx-auto max-w-[86rem] px-3 pt-3 sm:px-4 sm:pt-4">
      <div
        className="relative isolate overflow-hidden rounded-[1rem] sm:rounded-[1.375rem]"
        style={{
          background: `
            radial-gradient(circle at 13% 115%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 37%),
            linear-gradient(118deg, var(--shell) 0%, var(--shell) 43%, var(--shell) 72%, var(--ink-2) 100%)`,
          boxShadow: '0 24px 64px -24px color-mix(in srgb, var(--shell) 55%, transparent)',
        }}
      >
        {/* Faint engineering grid, fading out before it reaches the picture. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage: `
              linear-gradient(color-mix(in srgb, var(--shell-ink) 14%, transparent) 1px, transparent 1px),
              linear-gradient(90deg, color-mix(in srgb, var(--shell-ink) 14%, transparent) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
            WebkitMaskImage: 'linear-gradient(90deg, #000 0%, rgba(0,0,0,.75) 39%, transparent 67%)',
            maskImage: 'linear-gradient(90deg, #000 0%, rgba(0,0,0,.75) 39%, transparent 67%)',
          }}
        />

        {/* Amber warmth under the left corner. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-[370px] -left-[240px] h-[700px] w-[700px] rounded-full"
          style={{
            background:
              'radial-gradient(circle, color-mix(in srgb, var(--accent) 16%, transparent), transparent 68%)',
          }}
        />

        <div
          className={`relative z-10 flex flex-col justify-center px-5 pb-8 pt-8 text-center sm:px-8
            lg:min-h-[31.25rem] lg:py-11 lg:pl-[clamp(2.25rem,4vw,3.625rem)] lg:pr-6 lg:text-left
            ${imageAssetId ? 'lg:w-[56%]' : 'lg:w-[72%]'}`}
        >
          <p
            className="t-eyebrow mx-auto inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 lg:mx-0"
            style={{
              color: 'var(--shell-ink)',
              background: 'color-mix(in srgb, var(--shell-ink) 8%, transparent)',
              borderColor: 'var(--shell-line)',
            }}
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                background: 'var(--accent)',
                boxShadow: '0 0 0 5px color-mix(in srgb, var(--accent) 12%, transparent)',
              }}
            />
            {eyebrow}
          </p>

          <h1
            className="mt-4 text-[clamp(1.8rem,7vw,2.25rem)] font-[760] leading-[1.05] tracking-[-0.04em]
              lg:text-[clamp(2.7rem,3.7vw,3.5rem)]"
            style={{ color: 'var(--shell-ink)' }}
          >
            {title}
            {highlight && (
              <span className="mt-1.5 block" style={{ color: 'var(--accent)' }}>
                {highlight}
              </span>
            )}
          </h1>

          <p
            className="mx-auto mt-4 max-w-[40rem] text-[0.875rem] leading-relaxed lg:mx-0 lg:text-[0.9688rem]"
            style={{ color: 'var(--shell-muted)' }}
          >
            {blurb}
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-3 lg:justify-start">
            <Link
              href="/courses"
              className="inline-flex h-12 items-center gap-2 rounded-[0.625rem] px-6 text-sm font-bold transition
                hover:-translate-y-0.5 hover:brightness-105 motion-reduce:hover:translate-y-0"
              style={{
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
                boxShadow: '0 13px 28px -10px color-mix(in srgb, var(--shell) 60%, transparent)',
              }}
            >
              Explore courses
              <span aria-hidden>→</span>
            </Link>
            {sampleId && (
              <Link
                href="/sample"
                className="inline-flex h-12 items-center rounded-[0.625rem] border px-5 text-sm font-semibold transition hover:bg-white/10"
                style={{ borderColor: 'var(--shell-line)', color: 'var(--shell-ink)' }}
              >
                Try a lesson first
              </Link>
            )}
          </div>

          {google && (
            <div
              className="mt-5 flex justify-center lg:justify-start [&>span]:bg-[color-mix(in_srgb,var(--shell)_55%,transparent)]"
            >
              <GoogleBadge
                rating={google.rating}
                reviewCount={google.reviewCount}
                onDark
                className="border-[var(--shell-line)] backdrop-blur"
              />
            </div>
          )}

          {facts.length > 0 && (
            <dl className="mt-7 flex flex-wrap justify-center gap-x-8 gap-y-3 lg:justify-start">
              {facts.map((f) => (
                <div key={f.label}>
                  <dt className="t-small" style={{ color: 'var(--shell-muted)' }}>
                    {f.label}
                  </dt>
                  <dd
                    className="text-xl font-bold tabular-nums"
                    style={{ color: 'var(--shell-ink)' }}
                  >
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {imageAssetId && (
          <>
            {/*
              Rendered after the words on purpose. On a phone the picture is
              the lower half of the panel, which is where the WordPress hero
              puts it and where it belongs: a stranger should meet the
              sentence before the photograph. On a wide screen it is taken out
              of the flow and fills the right, so the order stops mattering.
            */}
            <div
              aria-hidden
              className="pointer-events-none relative z-[1] -mx-2 -mb-1 mt-1 lg:absolute lg:inset-y-0 lg:right-0 lg:m-0 lg:w-[52%]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/assets/${imageAssetId}`}
                alt=""
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="hero-photo h-full w-full object-cover object-center lg:object-right" 
              />
            </div>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 z-[2] hidden w-[62%] lg:block"
              style={{
                background: `linear-gradient(90deg,
                  var(--shell) 0%,
                  color-mix(in srgb, var(--shell) 96%, transparent) 42%,
                  color-mix(in srgb, var(--shell) 82%, transparent) 67%,
                  color-mix(in srgb, var(--shell) 42%, transparent) 84%,
                  transparent 100%)`,
              }}
            />
          </>
        )}
      </div>
    </section>
  );
}
