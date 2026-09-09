import Link from 'next/link';

/**
 * Admin navigation, grouped the way an institute actually thinks about the work
 * rather than the way the database is shaped.
 */
export interface NavChild {
  label: string;
  href: string;
  feature?: string;
  /** Not built yet. Shown so the map of the product is complete, but inert. */
  soon?: boolean;
}

export interface NavGroup {
  label: string;
  href?: string;
  icon: string;
  children?: NavChild[];
}

export const ADMIN_NAV: NavGroup[] = [
  { label: 'Home', href: '/admin', icon: 'home' },
  {
    label: 'Products',
    icon: 'box',
    children: [
      { label: 'Courses', href: '/admin/courses' },
      { label: 'Events', href: '/admin/events', feature: 'events' },
      { label: 'Memberships', href: '/admin/memberships', feature: 'memberships' },
      { label: 'Categories', href: '/admin/categories' },
    ],
  },
  {
    label: 'Learning',
    icon: 'book',
    children: [
      { label: 'Batches', href: '/admin/batches' },
      { label: 'Sessions', href: '/admin/sessions' },
      { label: 'Calendar', href: '/admin/calendar' },
      { label: 'Recordings', href: '/admin/recordings' },
      { label: 'Media library', href: '/admin/library' },
      { label: 'Module library', href: '/admin/modules' },
      { label: 'Question bank', href: '/admin/question-bank' },
      { label: 'Assessments', href: '/admin/assessments' },
      { label: 'Marking', href: '/admin/submissions' },
      { label: 'Certificates', href: '/admin/certificates' },
    ],
  },
  {
    label: 'People',
    icon: 'users',
    children: [
      { label: 'Learners', href: '/admin/learners' },
      { label: 'Team', href: '/admin/team' },
      { label: 'Instructors', href: '/admin/instructors' },
      { label: 'Enrol a learner', href: '/admin/enrol' },
      { label: 'Attendance', href: '/admin/attendance' },
      { label: 'Feedback', href: '/admin/feedback' },
    ],
  },
  {
    label: 'Growth',
    icon: 'spark',
    children: [
      { label: 'Enquiries', href: '/admin/leads' },
      { label: 'Promo codes', href: '/admin/promo-codes' },
      { label: 'Banners', href: '/admin/banners' },
      { label: 'Testimonials', href: '/admin/testimonials' },
      { label: 'Campaigns', href: '/admin/campaigns' },
      { label: 'Message templates', href: '/admin/templates' },
      { label: 'Segments', href: '/admin/segments' },
      { label: 'Community', href: '/admin/community' },
      { label: 'Points and referrals', href: '/admin/loyalty' },
      { label: 'Announcements', href: '/admin/announcements' },
      { label: 'Storefront', href: '/admin/storefront' },
      { label: 'Blog', href: '/admin/storefront' },
    ],
  },
  {
    label: 'Money',
    icon: 'card',
    children: [
      { label: 'Payments', href: '/admin/payments' },
      { label: 'Abandoned carts', href: '/admin/carts' },
      { label: 'Invoices', href: '/admin/invoices' },
      { label: 'Fee tracking', href: '/admin/fees' },
      { label: 'Cheques', href: '/admin/cheques' },
      { label: 'Settlements', href: '/admin/settlements' },
      { label: 'Refunds', href: '/admin/refunds' },
    ],
  },
  {
    label: 'Analytics',
    icon: 'chart',
    children: [
      { label: 'Sales', href: '/admin/analytics' },
      { label: 'Learning', href: '/admin/analytics/learning' },
      { label: 'Attendance', href: '/admin/analytics/attendance' },
    ],
  },
  { label: 'Settings', href: '/admin/settings', icon: 'gear' },
];

/**
 * The whole map of the product, including what is not built.
 *
 * Every unbuilt entry is marked `soon` and rendered inert with a visible dot, so
 * the shape of the thing is legible without any of it lying. A menu item that
 * navigates to a blank page is worse than one that plainly says it is not ready:
 * the first wastes a click and reads as broken, the second sets an expectation.
 * BUILD_PLAN.md is the authority on what each of them will do.
 */

const ICONS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  box: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9ZM12 12l8.5-4.5M12 12v9M12 12 3.5 7.5',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15ZM4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z',
  users: 'M16 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19M9.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1.5a4 4 0 0 0-3-3.87M16.5 3.6a3 3 0 0 1 0 5.8',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  card: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9ZM3 10h18M7 14h3',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-2.93-1.16l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.11a1.7 1.7 0 0 0 1.16-2.93l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 12 4.6V4.5a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 2.93 1.16l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 12h.1a2 2 0 1 1 0 4h-.1Z',
};

export function NavIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 shrink-0" aria-hidden>
      <path d={ICONS[name] ?? ICONS.box} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sidebar({ features, orgName }: { features: Record<string, boolean>; orgName: string }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-[var(--shell)] text-[var(--shell-ink)] lg:flex">
      <div className="flex h-14 items-center gap-2 border-b border-[var(--shell-line)] px-5">
        <span
          className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-xs font-bold"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
        >
          {orgName.slice(0, 1)}
        </span>
        <span className="truncate text-sm font-semibold">{orgName}</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-5">
          {ADMIN_NAV.map((group) => (
            <li key={group.label}>
              {group.href ? (
                <Link
                  href={group.href}
                  className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm text-[var(--shell-ink)] hover:bg-[var(--shell-2)]"
                >
                  <NavIcon name={group.icon} />
                  {group.label}
                </Link>
              ) : (
                <>
                  <p className="flex items-center gap-2.5 px-2.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--shell-muted)]">
                    <NavIcon name={group.icon} />
                    {group.label}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {(group.children ?? [])
                      .filter((c) => !c.feature || features[c.feature] !== false)
                      .map((c) =>
                        c.soon ? (
                          <li key={`${group.label}-${c.label}`}>
                            <span
                              aria-disabled="true"
                              title="Not built yet"
                              className="flex cursor-default items-center justify-between gap-2 rounded-[var(--radius-sm)] py-1.5 pl-9 pr-2.5 text-sm text-[var(--shell-muted)] opacity-55"
                            >
                              {c.label}
                              <span
                                aria-hidden
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--shell-muted)]"
                              />
                              <span className="sr-only">not built yet</span>
                            </span>
                          </li>
                        ) : (
                          <li key={c.href}>
                            <Link
                              href={c.href}
                              className="block rounded-[var(--radius-sm)] py-1.5 pl-9 pr-2.5 text-sm text-[var(--shell-muted)] hover:bg-[var(--shell-2)] hover:text-[var(--shell-ink)]"
                            >
                              {c.label}
                            </Link>
                          </li>
                        ),
                      )}
                  </ul>
                </>
              )}
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-[var(--shell-line)] px-5 py-3">
        <p className="flex items-center gap-2 text-[0.6875rem] text-[var(--shell-muted)]">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--shell-muted)]" />
          Dimmed items are not built yet
        </p>
      </div>
    </aside>
  );
}
