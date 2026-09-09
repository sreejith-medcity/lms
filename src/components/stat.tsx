import type { ReactNode } from 'react';

export function Stat({
  label,
  value,
  sub,
  trend,
}: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: { value: number; suffix?: string };
}) {
  return (
    <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-sm">
      <p className="t-micro faint">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {trend && (
          <span
            className="t-small font-medium tabular-nums"
            style={{ color: trend.value >= 0 ? 'var(--ok)' : 'var(--bad)' }}
          >
            {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}
            {trend.suffix ?? '%'}
          </span>
        )}
        {sub && <span className="t-small faint">{sub}</span>}
      </div>
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}
