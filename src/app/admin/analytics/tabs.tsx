'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const TABS = [
  { href: '/admin/analytics', label: 'Sales' },
  { href: '/admin/analytics/learning', label: 'Learning' },
  { href: '/admin/analytics/attendance', label: 'Attendance' },
  { href: '/admin/analytics/reports', label: 'All reports' },
];

const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'A year' },
];

export function AnalyticsTabs() {
  return (
    <Suspense fallback={<div className="h-10 border-b" />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const pathname = usePathname();
  const params = useSearchParams();
  const range = params.get('range') ?? '30';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b">
      <nav className="flex gap-1" aria-label="Analytics sections">
        {TABS.map((t) => {
          // The report pages live under the reports tab, so it stays lit there.
          const active =
            t.href === '/admin/analytics/reports'
              ? pathname.startsWith(t.href)
              : pathname === t.href;
          return (
            <Link
              key={t.href}
              href={`${t.href}?range=${range}`}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                active
                  ? 'border-[var(--brand)] font-medium text-[var(--ink)]'
                  : 'border-transparent text-[var(--ink-2)] hover:text-[var(--ink)]'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex gap-1 pb-2">
        {RANGES.map((r) => {
          const active = range === String(r.days);
          return (
            <Link
              key={r.days}
              href={`${pathname}?range=${r.days}`}
              className={`rounded-full border px-3 py-1 text-[0.8125rem] transition ${
                active
                  ? 'border-transparent text-[var(--brand-ink)]'
                  : 'bg-[var(--surface)] hover:border-[var(--brand)]'
              }`}
              style={active ? { background: 'var(--brand)' } : undefined}
            >
              {r.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
