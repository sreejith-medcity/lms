import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/nav';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/** Application surface: useful to the person signed in, useless in a search result. */
export const metadata = { robots: { index: false, follow: false } };


export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenantContext();
  if (!tenant) redirect('/');

  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.kind !== 'STAFF') redirect('/learn');

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-screen bg-[var(--canvas)]">
      <Sidebar features={tenant.features} orgName={tenant.name} logoUrl={tenant.logoUrl} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-[var(--surface)]/85 px-5 backdrop-blur">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="t-heading lg:hidden">
              {tenant.name}
            </Link>
            <span className="t-small faint hidden lg:inline">
              {tenant.slug}.{process.env.APP_BASE_DOMAIN ?? ''}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/" className="t-small muted hover:text-[var(--ink)]">
              View site
            </Link>
            <span className="h-5 w-px bg-[var(--line)]" />
            <span className="flex items-center gap-2">
              <span
                className="grid h-7 w-7 place-items-center rounded-full text-[0.6875rem] font-semibold"
                style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
              >
                {initials}
              </span>
              <span className="t-small hidden sm:inline">{user.name}</span>
            </span>
            <a href="/logout" className="t-small muted hover:text-[var(--ink)]">
              Sign out
            </a>
          </div>
        </header>

        <main className="rise flex-1 p-5 lg:p-7">{children}</main>
      </div>
    </div>
  );
}
