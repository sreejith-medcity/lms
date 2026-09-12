'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The learner's tabs, with the current one underlined. Scrolls sideways on a phone. */
export function LearnerNav({
  items,
  isStaff,
}: {
  items: { key: string; label: string; href: string }[];
  isStaff: boolean;
}) {
  const pathname = usePathname() ?? '/learn';
  const all = isStaff ? [...items, { key: 'admin', label: 'Admin', href: '/admin' }] : items;

  return (
    <nav className="rail -mb-px flex min-w-0 flex-1 items-stretch gap-1 self-stretch" aria-label="Learner">
      {all.map((item) => {
        const active =
          item.href === '/learn'
            ? pathname === '/learn' || /^\/learn\/(?!community|wallet|book|purchases|fees|practice|account|assignments)/.test(pathname)
            : item.href === '/'
              ? false
              : pathname.startsWith(item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex shrink-0 items-center border-b-2 px-3 text-sm font-medium transition ${
              active ? 'border-[var(--brand)] text-[var(--ink)]' : 'border-transparent text-[var(--ink-2)] hover:text-[var(--ink)]'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
