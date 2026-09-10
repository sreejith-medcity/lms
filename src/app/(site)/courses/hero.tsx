/**
 * The band at the top of the catalogue and of every category page.
 *
 * The search box is a plain GET form. No JavaScript, no client component, no
 * hydration: a learner on a slow phone can type and press go before the page
 * has finished loading, and the result is a real URL. The filters already in
 * play ride along as hidden fields so searching inside "Live, Beginner" does
 * not silently throw those away.
 */
export function CatalogueHero({
  eyebrow,
  title,
  blurb,
  action,
  hidden = {},
  q,
  stats,
}: {
  eyebrow: string;
  title: string;
  blurb: string;
  /** Where the form submits: /courses, or the category path. */
  action: string;
  hidden?: Record<string, string | undefined>;
  q?: string;
  stats?: { label: string; value: string }[];
}) {
  return (
    <section className="border-b bg-[var(--surface-2)]">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="t-eyebrow" style={{ color: 'var(--brand)' }}>
          {eyebrow}
        </p>
        <h1 className="t-hero mt-2 max-w-3xl">{title}</h1>
        <p className="t-lead muted mt-3 max-w-2xl">{blurb}</p>

        <form action={action} method="get" role="search" className="mt-6 max-w-xl">
          {Object.entries(hidden).map(([k, v]) =>
            v ? <input key={k} type="hidden" name={k} value={v} /> : null,
          )}
          <div
            className="flex items-center gap-2 rounded-full border bg-[var(--surface)] py-1.5 pl-4 pr-1.5
              shadow-sm focus-within:border-[var(--brand)]"
          >
            <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 shrink-0 text-[var(--ink-3)]">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-4.5-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <label htmlFor="catalogue-q" className="sr-only">
              Search courses
            </label>
            <input
              id="catalogue-q"
              name="q"
              type="search"
              defaultValue={q ?? ''}
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Search by course, exam or skill"
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ink-3)]"
            />
            <button
              type="submit"
              className="h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition hover:brightness-105"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              Search
            </button>
          </div>
        </form>

        {stats && stats.length > 0 && (
          <dl className="mt-7 flex flex-wrap gap-x-8 gap-y-3">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="t-small faint">{s.label}</dt>
                <dd className="text-lg font-bold tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
