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
    <div className="min-h-screen">
      <header
        className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-white"
        style={{ background: 'var(--brand)' }}
      >
        <Link href="/learn" className="font-medium">
          {tenant.name}
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/learn" className="opacity-90 hover:opacity-100">
            My learning
          </Link>
          <Link href="/" className="opacity-90 hover:opacity-100">
            Explore
          </Link>
          {user.kind === 'STAFF' && (
            <Link href="/admin" className="opacity-90 hover:opacity-100">
              Admin
            </Link>
          )}
          <span className="opacity-75">{user.name}</span>
          <a href="/logout" className="underline opacity-90 hover:opacity-100">
            Sign out
          </a>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
