import type { ReactNode } from 'react';
import { Card } from '@/components/ui';
import { Meter } from '@/components/chart';

/** A ranked breakdown. A bar per row rather than a pie: comparing lengths is easy. */
export function Breakdown({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { label: string; value: string; ratio: number; sub?: string; tone?: 'brand' | 'ok' | 'warn' | 'bad' }[];
  empty: string;
}) {
  return (
    <Card padded={false}>
      <h2 className="t-heading border-b px-5 py-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="t-small faint px-5 py-6">{empty}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.label} className="px-5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm">{r.label}</span>
                <span className="t-small shrink-0 tabular-nums">{r.value}</span>
              </div>
              <div className="mt-2">
                <Meter value={r.ratio} max={100} tone={r.tone ?? 'brand'} />
              </div>
              {r.sub && <p className="t-micro faint mt-1">{r.sub}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** What each figure on the page counts. Printed, not assumed. */
export function Definitions({ items }: { items: [string, ReactNode][] }) {
  return (
    <section className="mt-8 border-t pt-6">
      <h2 className="t-heading">What these numbers count</h2>
      <dl className="mt-3 space-y-2">
        {items.map(([term, meaning]) => (
          <div key={term} className="grid gap-1 sm:grid-cols-[200px_1fr] sm:gap-4">
            <dt className="t-small font-medium">{term}</dt>
            <dd className="t-small muted">{meaning}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
