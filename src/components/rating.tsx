/**
 * A rating, shown only where there is one.
 *
 * Five hollow stars and "no reviews yet" is worse than silence: it draws the
 * eye to the absence. A course nobody has reviewed says nothing here, and the
 * card gives the space back to something true.
 */
export function Rating({
  average,
  count,
  showCount = true,
  className = '',
}: {
  average: number;
  count: number;
  /** Off on a single review, where "(1)" next to its own stars says nothing. */
  showCount?: boolean;
  className?: string;
}) {
  const rounded = Math.round(average * 2) / 2;

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      aria-label={`Rated ${average} out of 5, from ${count} review${count === 1 ? '' : 's'}`}
    >
      <span aria-hidden className="inline-flex" style={{ color: 'var(--accent)' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} fill={rounded >= n ? 1 : rounded >= n - 0.5 ? 0.5 : 0} />
        ))}
      </span>
      <span className="t-small font-semibold tabular-nums">{average.toFixed(1)}</span>
      {showCount && <span className="t-small faint tabular-nums">({count})</span>}
    </span>
  );
}

// One shared gradient id for every half star on the page. A random id per
// render would differ between the server's HTML and the browser's, and the
// stops are identical anyway, so sharing one is both safe and smaller.
const HALF = 'mclms-half-star';

function Star({ fill }: { fill: 0 | 0.5 | 1 }) {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden>
      {fill === 0.5 && (
        <defs>
          <linearGradient id={HALF}>
            <stop offset="50%" stopColor="currentColor" />
            <stop offset="50%" stopColor="var(--line-strong)" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M10 1.6l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.21l-4.94 2.6.94-5.5-4-3.9 5.53-.8z"
        fill={fill === 1 ? 'currentColor' : fill === 0.5 ? `url(#${HALF})` : 'var(--line-strong)'}
      />
    </svg>
  );
}
