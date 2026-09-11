import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { ImpersonationBanner } from '@/components/impersonation-banner';
import { learnerNav } from '@/lib/learner-nav';
import { BrandLockup } from '@/components/brand-lockup';
import { LearnerNav } from './learner-nav';

export const dynamic = 'force-dynamic';

/** Application surface: useful to the person signed in, useless in a search result. */
export const metadata = { robots: { index: false, follow: false } };

export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (!tenant) redirect('/');
  if (!user) redirect('/login');

  const nav = await learnerNav(tenant.organizationId);
  const initial = user.name.trim().slice(0, 1).toUpperCase() || '?';

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <ImpersonationBanner learnerName={user.name} />
      <header className="sticky top-0 z-10 bg-[var(--surface)] shadow-[0_1px_0_var(--line),0_2px_8px_rgb(50_32_70/0.06)]">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-5">
          <Link href="/learn" className="flex shrink-0 items-center gap-2">
            <BrandLockup name={tenant.name} logoUrl={tenant.logoUrl} height={26} fallback="initial" />
          </Link>

          <LearnerNav items={nav} isStaff={user.kind === 'STAFF'} />

          <div className="ml-auto flex items-center gap-3">
            <span className="t-small faint hidden sm:inline">{user.name}</span>
            <span
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-[var(--brand-ink)]"
              style={{ background: 'var(--brand)' }}
            >
              {initial}
            </span>
            <a href="/logout" className="t-small muted hover:text-[var(--ink)]">
              Sign out
            </a>
          </div>
        </div>
      </header>

      {/* No container here: the player wants the full width for its curriculum rail.
          Pages that want a reading measure add their own. */}
      <main className="rise">{children}</main>
    </div>
  );
}
