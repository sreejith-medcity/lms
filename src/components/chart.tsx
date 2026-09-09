'use client';

import { useId, useMemo, useState } from 'react';

export interface ColumnPoint {
  label: string;
  /** Short form for the axis; the full label goes in the tooltip and the table. */
  axisLabel?: string;
  value: number;
  display: string;
}

/**
 * A single-series column chart.
 *
 * Single series, so no legend: the heading already says what is plotted, and a
 * one-swatch legend box would only restate it. Only the largest column carries a
 * printed value; the rest are read from the axis, the tooltip, or the table view
 * underneath, which is also what makes the chart usable without hover at all.
 *
 * Built from divs rather than SVG so every column is its own hit target and the
 * whole thing reflows with the card instead of scaling like an image.
 */
export function ColumnChart({
  points,
  height = 176,
  emptyMessage = 'Nothing recorded in this period yet.',
}: {
  points: ColumnPoint[];
  height?: number;
  emptyMessage?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const max = useMemo(() => Math.max(...points.map((p) => p.value), 0), [points]);
  const ticks = useMemo(() => niceTicks(max), [max]);
  const scaleTop = ticks[ticks.length - 1] || 1;
  const everythingZero = max === 0;

  return (
    <div>
      <div className="relative" style={{ height }}>
        {/* Gridlines sit one step off the surface and stay hairline, so the data
            is the only loud thing on the card. */}
        <div className="absolute inset-0">
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 flex items-center"
              style={{ bottom: `${(t / scaleTop) * 100}%` }}
            >
              <span className="t-micro faint w-12 shrink-0 pr-2 text-right tabular-nums">
                {compact(t)}
              </span>
              <span className="h-px flex-1 bg-[var(--line)]" />
            </div>
          ))}
        </div>

        <div className="absolute inset-y-0 left-12 right-0 flex items-end gap-[2px]">
          {points.map((p, i) => {
            const pct = scaleTop ? (p.value / scaleTop) * 100 : 0;
            const isMax = !everythingZero && p.value === max;

            return (
              <div
                key={p.label}
                className="group relative flex h-full flex-1 cursor-default items-end justify-center"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${p.label}: ${p.display}`}
              >
                {isMax && (
                  <span
                    className="t-micro absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[var(--ink-2)]"
                    style={{ bottom: `calc(${pct}% + 6px)` }}
                  >
                    {p.display}
                  </span>
                )}

                <div
                  className="w-full max-w-[24px] rounded-t-[4px] transition-[height]"
                  style={{
                    height: `${Math.max(pct, p.value > 0 ? 2 : 0)}%`,
                    background: 'var(--brand)',
                    opacity: hover === null || hover === i ? 1 : 0.45,
                  }}
                />

                {hover === i && (
                  <div
                    className="pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-[var(--radius-sm)]
                      border bg-[var(--surface)] px-2.5 py-1.5 shadow-[var(--shadow)]"
                  >
                    <span className="t-micro faint block">{p.label}</span>
                    <span className="text-sm font-medium tabular-nums">{p.display}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="ml-12 mt-2 flex gap-[2px]">
        {points.map((p, i) => (
          <span
            key={p.label}
            className={`t-micro flex-1 text-center ${hover === i ? 'text-[var(--ink-2)]' : 'faint'}`}
          >
            {p.axisLabel ?? p.label}
          </span>
        ))}
      </div>

      {everythingZero && <p className="t-small faint mt-3">{emptyMessage}</p>}

      <button
        type="button"
        aria-expanded={showTable}
        aria-controls={tableId}
        onClick={() => setShowTable((v) => !v)}
        className="t-small faint mt-3 underline hover:text-[var(--ink-2)]"
      >
        {showTable ? 'Hide the numbers' : 'Show the numbers'}
      </button>

      {showTable && (
        <div id={tableId} className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {points.map((p) => (
                <tr key={p.label} className="border-b last:border-0">
                  <td className="py-1.5 pr-4">{p.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{p.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Round numbers on the axis, because 0 / 25,000 / 50,000 reads and 17,483 does not. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 3;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v));
  if (out[out.length - 1] < max) out.push(Math.round(out[out.length - 1] + step));
  return out;
}

function compact(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(n % 1e7 ? 1 : 0)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`;
  return String(n);
}

/**
 * A single ratio against a limit. Same-ramp track, so the state reads across the
 * whole bar rather than only in the filled part.
 */
export function Meter({
  value,
  max = 100,
  tone = 'brand',
}: {
  value: number;
  max?: number;
  tone?: 'brand' | 'ok' | 'warn' | 'bad';
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const colour = tone === 'brand' ? 'var(--brand)' : `var(--${tone})`;

  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: `color-mix(in srgb, ${colour} 16%, transparent)` }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colour }} />
    </div>
  );
}
