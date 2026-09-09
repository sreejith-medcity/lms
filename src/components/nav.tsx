import Link from 'next/link';

/** Mirrors the module map from the Edmingle audit, minus the parts we fold in elsewhere. */
export const ADMIN_NAV = [
  { label: 'Home', href: '/admin', permission: 'dashboard.view_dashboard' },
  {
    label: 'Products',
    permission: 'courses.course_management',
    children: [
      { label: 'Courses', href: '/admin/courses' },
      { label: 'Events', href: '/admin/events', feature: 'events' },
      { label: 'Memberships', href: '/admin/memberships', feature: 'memberships' },
      { label: 'Mentorships', href: '/admin/mentorships', feature: 'mentorships' },
    ],
  },
  {
    label: 'Learning',
    permission: 'batches.batch_management',
    children: [
      { label: 'Batches', href: '/admin/batches' },
      { label: 'Sessions', href: '/admin/sessions' },
      { label: 'Announcements', href: '/admin/announcements' },
      { label: 'Feedback Forms', href: '/admin/feedback-forms' },
      { label: 'Module Library', href: '/admin/modules' },
      { label: 'Question Bank', href: '/admin/question-bank' },
      { label: 'Asset Library', href: '/admin/assets' },
      { label: 'Assessments', href: '/admin/assessments' },
      { label: 'Submissions', href: '/admin/submissions' },
      { label: 'Recordings', href: '/admin/recordings' },
      { label: 'Certificates', href: '/admin/certificates' },
    ],
  },
  {
    label: 'Users',
    permission: 'learner.learner_management',
    children: [
      { label: 'Learners', href: '/admin/learners' },
      { label: 'Team', href: '/admin/team' },
      { label: 'Segments', href: '/admin/segments' },
      { label: 'New Enrolment', href: '/admin/enrol' },
    ],
  },
  {
    label: 'Engage',
    permission: 'community.manage_communities',
    children: [
      { label: 'Community', href: '/admin/community', feature: 'community' },
      { label: 'Loyalty', href: '/admin/loyalty' },
      { label: 'Discussions', href: '/admin/discussions' },
    ],
  },
  {
    label: 'Marketing',
    permission: 'marketing.campaigns',
    children: [
      { label: 'Campaigns', href: '/admin/campaigns' },
      { label: 'Workflows', href: '/admin/workflows' },
      { label: 'Storefront', href: '/admin/storefront' },
      { label: 'Blogs', href: '/admin/blogs' },
      { label: 'Leads', href: '/admin/leads' },
      { label: 'Templates', href: '/admin/templates' },
      { label: 'Promo Codes', href: '/admin/promo-codes' },
      { label: 'Testimonials', href: '/admin/testimonials' },
    ],
  },
  {
    label: 'Sales',
    permission: 'sales.payments',
    children: [
      { label: 'Payments', href: '/admin/payments' },
      { label: 'Fee Tracking', href: '/admin/fees' },
      { label: 'Settlements', href: '/admin/settlements' },
      { label: 'Cheques', href: '/admin/cheques' },
      { label: 'Abandoned Carts', href: '/admin/abandoned-carts' },
    ],
  },
  { label: 'Analytics', href: '/admin/analytics', permission: 'reports.sales_reports' },
  { label: 'Settings', href: '/admin/settings', permission: 'settings.organization' },
] as const;

export function Sidebar({ features }: { features: Record<string, boolean> }) {
  return (
    <nav className="w-56 shrink-0 border-r bg-white p-4 text-sm">
      <ul className="space-y-4">
        {ADMIN_NAV.map((item) => (
          <li key={item.label}>
            {'href' in item ? (
              <Link href={item.href} className="font-medium hover:underline">
                {item.label}
              </Link>
            ) : (
              <>
                <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">
                  {item.label}
                </p>
                <ul className="space-y-1">
                  {item.children
                    .filter((c) => !('feature' in c) || features[c.feature as string] !== false)
                    .map((c) => (
                      <li key={c.href}>
                        <Link href={c.href} className="text-slate-600 hover:text-slate-900">
                          {c.label}
                        </Link>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
