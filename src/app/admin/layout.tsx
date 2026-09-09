import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/nav';
import { getTenantContext } from '@/lib/tenant';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenantContext();
  if (!tenant) redirect('/');

  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.kind !== 'STAFF') redirect('/');

  return (
    <div className="flex min-h-screen">
      <Sidebar features={tenant.features} />
      <div className="flex-1">
        <header
          className="flex items-center justify-between px-6 py-3 text-white"
          style={{ background: 'var(--brand)' }}
        >
          <span className="font-medium">{tenant.name}</span>
          <span className="flex items-center gap-4 text-xs opacity-90">
            <span>{user.name}</span>
            <a href="/logout" className="underline">
              Sign out
            </a>
          </span>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
