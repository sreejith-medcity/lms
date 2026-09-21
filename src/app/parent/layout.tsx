import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { getParentSession } from '@/lib/parent-session';
import { BrandLockup } from '@/components/brand-lockup';
import { inApp } from '@/lib/in-app';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The parent's surface: the academy's mark, a "parent view" label so nobody
 * mistakes it for the learner's portal, and three places to go: Home (the
 * children), Notices (the inbox, with the unread count) and Account (devices
 * and sign-out). Pages about one child pin the child and their own tabs.
 */
export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenantContext();
  if (!tenant) redirect('/');
  const session = await getParentSession();
  const unread = session ? await db.parentNotification.count({ where: { organizationId: tenant.organizationId, contact: session.contact, readAt: null } }) : 0;

  if (await inApp()) return <main className="min-h-screen bg-[var(--canvas)]">{children}</main>;

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <header className="sticky top-0 z-10 bg-[var(--surface)] shadow-[0_1px_0_var(--line),0_2px_8px_rgb(50_32_70/0.06)]">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-4 px-5">
          <Link href="/parent" className="flex shrink-0 items-center gap-2">
            <BrandLockup name={tenant.name} logoUrl={tenant.logoUrl} height={26} fallback="initial" />
          </Link>
          <span className="hidden rounded-full border px-2.5 py-0.5 text-xs font-medium sm:inline">Parent view</span>
          {session ? (
            <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="Parent view">
              <Link href="/parent" className="rounded-[var(--radius-sm)] px-2.5 py-1.5 hover:bg-[var(--surface-2)]">
                Home
              </Link>
              <Link href="/parent/notices" className="relative rounded-[var(--radius-sm)] px-2.5 py-1.5 hover:bg-[var(--surface-2)]">
                Notices
                {unread > 0 && (
                  <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-[var(--brand-ink)]" style={{ background: 'var(--brand)' }}>
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
              <Link href="/parent/account" className="rounded-[var(--radius-sm)] px-2.5 py-1.5 hover:bg-[var(--surface-2)]">
                Account
              </Link>
            </nav>
          ) : (
            <div className="ml-auto flex items-center gap-4">
              <Link href="/" className="t-small muted hover:underline">
                Website
              </Link>
            </div>
          )}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
