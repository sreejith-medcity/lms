import Link from 'next/link';

/**
 * The heading over a catalogue page. Small, because the search box in the
 * header is the search, and the filters do the rest: a big band here would
 * push the first result below the fold on every phone.
 */
export function CatalogueHeading({
  title,
  blurb,
  crumb,
  q,
}: {
  title: string;
  blurb?: string;
  /** The category page links back to the whole catalogue. */
  crumb?: { href: string; label: string };
  q?: string;
}) {
  return (
    <div className="mb-6">
      {crumb && (
        <Link href={crumb.href} className="t-small font-medium hover:underline" style={{ color: 'var(--brand)' }}>
          {crumb.label}
        </Link>
      )}
      <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
        {q ? `Results for “${q}”` : title}
      </h1>
      {blurb && !q && <p className="t-small muted mt-1.5 max-w-2xl">{blurb}</p>}
    </div>
  );
}
