/**
 * The picture on a course card and at the top of a course page.
 *
 * A catalogue where half the courses have artwork and half have a grey box is
 * worse than one with no artwork at all, and an institute migrating sixty-five
 * products will not have uploaded sixty-five images on day one. So the fallback
 * is designed rather than empty: the course initials on a wash derived from its
 * own title, which gives every card a distinct, stable colour without anybody
 * uploading anything. Same title, same colour, on every page and every reload.
 */

/** A stable hue per title. Not random: a card must not change colour on reload. */
function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

function initials(title: string): string {
  const words = title
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function CourseMedia({
  title,
  assetId,
  priority = false,
  className = '',
  rounded = '',
  ratio = 'aspect-square',
}: {
  title: string;
  assetId?: string | null;
  /** The one image above the fold on a course page loads eagerly. Cards do not. */
  priority?: boolean;
  className?: string;
  rounded?: string;
  /**
   * Square by default, because the artwork an academy already has is square
   * and cropping it would cut the words off somebody's course banner. A small
   * teaser can ask for a shorter box.
   */
  ratio?: string;
}) {
  const shell = `relative block ${ratio} w-full overflow-hidden bg-[var(--surface-2)] ${rounded} ${className}`;

  if (assetId) {
    return (
      <span className={shell}>
        {/* Plain img, not next/image: these come from a signed redirect whose
            destination changes, which the optimiser cannot cache usefully. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/assets/${assetId}`}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'low'}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  const hue = hueOf(title);

  return (
    <span
      className={`${shell} grid place-items-center`}
      style={{
        background: `linear-gradient(140deg,
          hsl(${hue} 42% 92%) 0%,
          hsl(${(hue + 28) % 360} 46% 86%) 100%)`,
      }}
    >
      <span
        aria-hidden
        className="select-none text-[2rem] font-bold tracking-tight"
        style={{ color: `hsl(${hue} 38% 28%)` }}
      >
        {initials(title)}
      </span>
    </span>
  );
}
