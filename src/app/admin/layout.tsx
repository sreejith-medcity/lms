import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/nav';
import { getTenantContext } from '@/lib/tenant';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenantContext();
  if (!tenant) redirect('/');

  return (
    <div className="flex min-h-screen">
      <Sidebar features={tenant.features} />
      <div className="flex-1">
        <header
          className="flex items-center justify-between px-6 py-3 text-white"
          style={{ background: 'var(--brand)' }}
        >
          <span className="font-medium">{tenant.name}</span>
          <span className="text-xs opacity-80">
            {tenant.status} · {tenant.slug}
          </span>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
