import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPlatformUser, onPlatformHost } from '@/lib/platform/session';
import { platformLogout } from '@/server/platform';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const NAV = [
  { href: '/platform', label: 'Overview' },
  { href: '/platform/tenants', label: 'Academies' },
  { href: '/platform/plans', label: 'Plans' },
  { href: '/platform/team', label: 'Console users' },
];

/**
 * The control plane. Answers on the platform host only; on any academy's
 * hostname these routes do not exist. Signed-out visitors see the sign-in
 * and the public start page, nothing else.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  if (!(await onPlatformHost())) notFound();
  const me = await getPlatformUser();
  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <header className="bg-[var(--surface)] shadow-[0_1px_0_var(--line)]">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-5 px-5">
          <Link href="/platform" className="font-semibold">Platform</Link>
          {me && (
            <nav className="flex gap-1">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">{n.label}</Link>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3">
            {me ? (
              <>
                <span className="t-small faint">{me.name} · {me.role.toLowerCase().replace('_', ' ')}</span>
                <form action={platformLogout}>
                  <button type="submit" className="t-small muted hover:underline">Sign out</button>
                </form>
              </>
            ) : (
              <Link href="/platform/login" className="t-small underline">Sign in</Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-7">{children}</main>
    </div>
  );
}
