'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/settings', label: 'Organisation' },
  { href: '/admin/settings/branches', label: 'Branches' },
  { href: '/admin/settings/taxes', label: 'Tax' },
  { href: '/admin/settings/roles', label: 'Roles' },
  { href: '/admin/settings/sessions', label: 'Devices' },
  { href: '/admin/settings/preferences', label: 'Preferences' },
  { href: '/admin/settings/custom-fields', label: 'Custom fields' },
  { href: '/admin/settings/notifications', label: 'Notifications' },
  { href: '/admin/settings/learner-portal', label: 'Learner portal' },
  { href: '/admin/settings/website', label: 'Website' },
  { href: '/admin/settings/redirects', label: 'Redirects' },
  { href: '/admin/settings/grading', label: 'Grading' },
  { href: '/admin/settings/programs', label: 'Programs' },
  { href: '/admin/settings/integrations', label: 'Integrations' },
  { href: '/admin/settings/messaging', label: 'Messaging' },
  { href: '/admin/settings/email-domain', label: 'Email domain' },
  { href: '/admin/settings/migration', label: 'Migration' },
  { href: '/admin/settings/billing', label: 'Billing' },
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
