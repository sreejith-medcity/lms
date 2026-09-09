import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (!tenant) redirect('/');
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <header className="sticky top-0 z-10 border-b bg-[var(--surface)]/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5">
          <Link href="/learn" className="flex items-center gap-2">
            <span
              className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-xs font-bold"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              {tenant.name.slice(0, 1)}
            </span>
            <span className="t-heading truncate">{tenant.name}</span>
          </Link>

          <nav className="flex items-center gap-4">
            <Link href="/learn" className="t-small muted hover:text-[var(--ink)]">
              My learning
            </Link>
            <Link href="/" className="t-small muted hover:text-[var(--ink)]">
              Explore
            </Link>
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

      <main className="rise mx-auto max-w-5xl px-5 py-7">{children}</main>
    </div>
  );
}
