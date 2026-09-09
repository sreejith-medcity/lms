'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function CourseTabs({
  productId,
  tabs,
}: {
  productId: string;
  tabs: { href: string; label: string }[];
}) {
  const pathname = usePathname();
  const base = `/admin/courses/${productId}`;

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b" aria-label="Course sections">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active = pathname === href;
        return (
          <Link
            key={t.label}
            href={href}
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
  );
}
