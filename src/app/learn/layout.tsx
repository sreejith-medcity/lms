import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { ImpersonationBanner } from '@/components/impersonation-banner';
import { learnerNav } from '@/lib/learner-nav';
import { BrandLockup } from '@/components/brand-lockup';

export const dynamic = 'force-dynamic';

/** Application surface: useful to the person signed in, useless in a search result. */
export const metadata = { robots: { index: false, follow: false } };


export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (!tenant) redirect('/');
  if (!user) redirect('/login');

  const nav = await learnerNav(tenant.organizationId);

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <ImpersonationBanner learnerName={user.name} />
      <header className="sticky top-0 z-10 border-b bg-[var(--surface)]/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5">
          <Link href="/learn" className="flex items-center gap-2">
            <BrandLockup
              name={tenant.name}
              logoUrl={tenant.logoUrl}
              height={26}
              fallback="initial"
            />
          </Link>

          <nav className="flex items-center gap-4">
            {nav.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="t-small muted hover:text-[var(--ink)]"
              >
                {item.label}
              </Link>
            ))}
            {user.kind === 'STAFF' && (
              <Link href="/admin" className="t-small muted hover:text-[var(--ink)]">
                Admin
              </Link>
            )}
            <a href="/logout" className="t-small muted hover:text-[var(--ink)]">
              Sign out
            </a>
          </nav>
        </div>
      </header>

      {/* No container here: the player wants the full width for its curriculum rail.
          Pages that want a reading measure add their own. */}
      <main className="rise">{children}</main>
    </div>
  );
}
