/* eslint-disable @next/next/no-img-element */

/**
 * The academy's name, as a logo where there is one.
 *
 * One component so the three headers cannot drift: an academy that uploads a
 * logo should not find it on the public site and nowhere else. The name is kept
 * as the alt text rather than dropped, because a logo that fails to load should
 * still say who this is.
 */
export function BrandLockup({
  name,
  logoUrl,
  height = 28,
  fallback = 'wordmark',
  className = '',
}: {
  name: string;
  logoUrl: string | null;
  height?: number;
  /** What to show with no logo: the name, or its first letter in a tile. */
  fallback?: 'wordmark' | 'initial';
  className?: string;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        style={{ height }}
        className={`w-auto max-w-52 object-contain ${className}`}
      />
    );
  }

  if (fallback === 'initial') {
    return (
      <span className={`flex items-center gap-2 ${className}`}>
        <span
          className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-xs font-bold"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
        >
          {name.slice(0, 1)}
        </span>
        <span className="t-heading truncate">{name}</span>
      </span>
    );
  }

  return <span className={`inline-block text-base font-semibold tracking-tight ${className}`}>{name}</span>;
}
