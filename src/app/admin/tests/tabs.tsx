'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/tests', label: 'Content' },
  { href: '/admin/tests/sittings', label: 'Papers sat' },
  { href: '/admin/tests/marking', label: 'Marking' },
  { href: '/admin/tests/assignments', label: 'Set a paper' },
  { href: '/admin/tests/grants', label: 'Free papers' },
];

export function TestsTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b" aria-label="Mock test sections">
      {TABS.map((t) => {
        const active = t.href === '/admin/tests' ? pathname === t.href || pathname.startsWith('/admin/tests/sets') : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              active ? 'border-[var(--brand)] font-medium text-[var(--ink)]' : 'border-transparent text-[var(--ink-2)] hover:text-[var(--ink)]'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
