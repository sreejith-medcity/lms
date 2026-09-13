import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant';
import { BrandLockup } from '@/components/brand-lockup';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The parent's surface: the academy's mark, a "parent view" label so nobody
 * mistakes it for the learner's portal, and nothing to click that changes
 * anything.
 */
export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenantContext();
  if (!tenant) redirect('/');
  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <header className="sticky top-0 z-10 bg-[var(--surface)] shadow-[0_1px_0_var(--line),0_2px_8px_rgb(50_32_70/0.06)]">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-4 px-5">
          <Link href="/parent" className="flex shrink-0 items-center gap-2">
            <BrandLockup name={tenant.name} logoUrl={tenant.logoUrl} height={26} fallback="initial" />
          </Link>
          <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium">Parent view</span>
          <div className="ml-auto flex items-center gap-4">
            <Link href="/" className="t-small muted hover:underline">Website</Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
