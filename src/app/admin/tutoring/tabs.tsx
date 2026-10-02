'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/tutoring', label: 'Groups' },
  { href: '/admin/tutoring/learners', label: 'Learners' },
  { href: '/admin/tutoring/tutors', label: 'Courses and tutors' },
  { href: '/admin/tutoring/leave', label: 'Leave' },
  { href: '/admin/tutoring/feedback', label: 'Feedback' },
  { href: '/admin/tutoring/hours', label: 'Hours' },
];

export function TutoringTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b" aria-label="Online tutoring sections">
      {TABS.map((t) => {
        const active = t.href === '/admin/tutoring' ? pathname === t.href || pathname.startsWith('/admin/tutoring/groups') : pathname.startsWith(t.href);
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
