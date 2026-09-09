'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/settings', label: 'Organisation' },
  { href: '/admin/settings/branches', label: 'Branches' },
  { href: '/admin/settings/taxes', label: 'Tax' },
  { href: '/admin/settings/roles', label: 'Roles' },
  { href: '/admin/settings/learner-portal', label: 'Learner portal' },
  { href: '/admin/settings/integrations', label: 'Integrations' },
];

export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 border-b" aria-label="Settings sections">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
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
