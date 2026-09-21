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
  { label: 'My teaching', href: '/admin/desk', icon: 'book' },
  { label: 'Register', href: '/admin/register', icon: 'check' },
  { label: 'Mark sheets', href: '/admin/marksheets', icon: 'chart' },
  { label: 'Approvals', href: '/admin/approvals', icon: 'check' },
  { label: 'Branch desk', href: '/admin/branch', icon: 'home' },
  {
    label: 'Products',
    icon: 'box',
    children: [
      { label: 'Courses', href: '/admin/courses' },
      { label: 'Bundles', href: '/admin/bundles' },
      { label: 'Pricing templates', href: '/admin/pricing-templates' },
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
      { label: 'One to one', href: '/admin/one-to-one' },
      { label: 'Calendar', href: '/admin/calendar' },
      { label: 'Recordings', href: '/admin/recordings' },
      { label: 'Media library', href: '/admin/library' },
      { label: 'Module library', href: '/admin/modules' },
      { label: 'Question bank', href: '/admin/question-bank' },
      { label: 'Assessments', href: '/admin/assessments' },
      { label: 'Assignments', href: '/admin/assignments' },
      { label: 'Marking', href: '/admin/submissions' },
      { label: 'Questions', href: '/admin/questions' },
      { label: 'Certificates', href: '/admin/certificates' },
    ],
  },
  {
    label: 'People',
    icon: 'users',
    children: [
      { label: 'Learners', href: '/admin/learners' },
      { label: 'Help desk', href: '/admin/help' },
      { label: 'Data requests', href: '/admin/data-requests' },
      { label: 'Team', href: '/admin/team' },
      { label: 'Instructors', href: '/admin/instructors' },
      { label: 'Trainer payouts', href: '/admin/payouts' },
      { label: 'Enrol a learner', href: '/admin/enrol' },
      { label: 'Attendance', href: '/admin/attendance' },
      { label: 'Counter', href: '/admin/counter' },
      { label: 'Feedback', href: '/admin/feedback' },
    ],
  },
  {
    label: 'Growth',
    icon: 'spark',
    children: [
      { label: 'Enquiries', href: '/admin/leads' },
      { label: 'Promo codes', href: '/admin/promo-codes' },
      { label: 'Affiliates', href: '/admin/affiliates' },
      { label: 'Banners', href: '/admin/banners' },
      { label: 'Testimonials', href: '/admin/testimonials' },
      { label: 'Campaigns', href: '/admin/campaigns' },
      { label: 'Automations', href: '/admin/workflows' },
      { label: 'Message templates', href: '/admin/templates' },
      { label: 'Segments', href: '/admin/segments' },
      { label: 'Community', href: '/admin/community' },
      { label: 'Points and referrals', href: '/admin/loyalty' },
      { label: 'Notices', href: '/admin/notices' },
      { label: 'Announcements', href: '/admin/announcements' },
      { label: 'Storefront', href: '/admin/storefront' },
      { label: 'Course landing pages', href: '/admin/storefront/landing' },
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
      { label: 'Fees and dues', href: '/admin/fees' },
      { label: 'Prepaid passes', href: '/admin/passes' },
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
      { label: 'All reports', href: '/admin/analytics/reports' },
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
  check: 'M4 12.5l5 5L20 6.5',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-2.93-1.16l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.11a1.7 1.7 0 0 0 1.16-2.93l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 12 4.6V4.5a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 2.93 1.16l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 12h.1a2 2 0 1 1 0 4h-.1Z',
};

export function NavIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 shrink-0" aria-hidden>
      <path d={ICONS[name] ?? ICONS.box} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

