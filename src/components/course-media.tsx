/**
 * The picture on a course card and at the top of a course page.
 *
 * A catalogue where half the courses have artwork and half have a grey box is
 * worse than one with no artwork at all, and an institute migrating sixty-five
 * products will not have uploaded sixty-five images on day one. So the fallback
 * is designed rather than empty: the course initials on a wash derived from its
 * own title, which gives every card a distinct, stable colour without anybody
 * uploading anything. Same title, same colour, on every page and every reload.
 *
 * The frame never cuts the artwork. Course banners carry words ("A1",
 * "BEGINNER", a price), and an academy's library is a mix of the square art
 * it made for the old system and the 16:9 art it makes now. So inside a
 * fixed frame the picture is fitted whole, and the strip it leaves on either
 * side is filled with a blurred copy of itself rather than a flat bar. At the
 * top of a course page there is no frame at all: the card takes the shape
 * of the picture, landscape or square, as it was uploaded.
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
  fit = 'frame',
}: {
  title: string;
  assetId?: string | null;
  /** The one image above the fold on a course page loads eagerly. Cards do not. */
  priority?: boolean;
  className?: string;
  rounded?: string;
  /**
   * The frame's shape, as a Tailwind aspect class. Used for the fallback
   * art always, and for the picture when `fit` is `frame`.
   */
  ratio?: string;
  /**
   * `frame`: the picture sits whole inside the frame, letterboxed with a
   * blur of itself. `natural`: no frame; the box is as tall as the picture
   * is, capped so a portrait upload cannot push the buy button off screen.
   */
  fit?: 'frame' | 'natural';
}) {
  if (assetId) {
    const src = `/api/assets/${assetId}`;
    const loading = priority ? ('eager' as const) : ('lazy' as const);
    const fetchPriority = priority ? ('high' as const) : ('low' as const);

    if (fit === 'natural') {
      return (
        <span className={`relative block w-full overflow-hidden bg-[var(--surface-2)] ${rounded} ${className}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" loading={loading} decoding="async" fetchPriority={fetchPriority} className="block h-auto max-h-[26rem] w-full object-cover" />
        </span>
      );
    }

    return (
      <span className={`relative block ${ratio} w-full overflow-hidden bg-[var(--surface-2)] ${rounded} ${className}`}>
        {/* Plain img, not next/image: these come from a signed redirect whose
            destination changes, which the optimiser cannot cache usefully.
            The same file twice costs one request; the browser serves the
            second from the first. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" aria-hidden loading={loading} decoding="async" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-xl" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading={loading} decoding="async" fetchPriority={fetchPriority} className="relative h-full w-full object-contain" />
      </span>
    );
  }

  const shell = `relative block ${ratio} w-full overflow-hidden bg-[var(--surface-2)] ${rounded} ${className}`;
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
