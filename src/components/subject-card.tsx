import Link from 'next/link';
import { CourseMedia } from '@/components/course-media';

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
 */
export function SubjectCard({ subject, priority = false }: { subject: Subject; priority?: boolean }) {
  const href = `/courses/${subject.slug}`;
  const count = subject._count.courses;

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--surface)] shadow-sm
        ${subject.comingSoon ? '' : 'lift'}`}
    >
      {subject.comingSoon ? (
        <CourseMedia
          title={subject.name}
          assetId={subject.imageAssetId}
          ratio="aspect-[4/3]"
          priority={priority}
          className="opacity-70"
        />
      ) : (
        <Link href={href} tabIndex={-1} aria-hidden className="block">
          <CourseMedia
            title={subject.name}
            assetId={subject.imageAssetId}
            ratio="aspect-[4/3]"
            priority={priority}
          />
        </Link>
      )}

      <div className="flex flex-1 flex-col p-5">
        <h3 className="t-card-title">
          {subject.comingSoon ? (
            subject.name
          ) : (
            <Link href={href} className="transition hover:text-[var(--brand)]">
              {subject.name}
            </Link>
          )}
        </h3>

        {subject.tagline && (
          <p className="t-small muted mt-2 leading-relaxed">{subject.tagline}</p>
        )}

        <div className="mt-auto pt-5">
          {subject.comingSoon ? (
            <span
              className="t-eyebrow inline-flex h-11 w-full items-center justify-center rounded-[var(--radius-sm)] border border-dashed"
              style={{ color: 'var(--ink-2)' }}
            >
              Coming soon
            </span>
          ) : (
            <Link
              href={href}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)]
                px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:brightness-110"
              style={{ background: 'var(--brand)' }}
            >
              {subject.ctaLabel?.trim() || `Browse ${subject.name}`}
              <span aria-hidden>→</span>
            </Link>
          )}
        </div>

        {!subject.comingSoon && count > 0 && (
          <p className="t-small faint mt-2.5 text-center tabular-nums">
            {count} course{count === 1 ? '' : 's'}
          </p>
        )}
      </div>
    </article>
  );
}
