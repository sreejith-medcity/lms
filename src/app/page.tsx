import Link from 'next/link';
import { getTenantContext } from '@/lib/tenant';
import { db } from '@/lib/db';
import { formatMoney } from '@/lib/money';

export default async function Home() {
  const tenant = await getTenantContext();

  if (!tenant) {
    return (
      <main className="mx-auto max-w-2xl p-10">
        <h1 className="text-2xl font-semibold">No tenant for this hostname</h1>
        <p className="mt-2 text-slate-600">
          Point a subdomain at this app, or add the hostname under Tenant Domains in
          the platform console.
        </p>
      </main>
    );
  }

  const courses = await db.product.findMany({
    where: { organizationId: tenant.organizationId, type: 'COURSE', status: 'PUBLISHED' },
    include: { course: true, pricingPlans: { where: { isActive: true }, take: 1 } },
    take: 24,
  });

  return (
    <main className="mx-auto max-w-6xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <Link href="/admin" className="text-sm text-slate-600 hover:underline">
          Admin
        </Link>
      </header>

      <h2 className="mb-4 text-lg font-medium">Explore courses</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((p) => {
          const plan = p.pricingPlans[0];
          return (
            <article key={p.id} className="rounded-xl border bg-white p-5">
              <h3 className="font-medium">{p.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                {p.course?.description ?? ''}
              </p>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-lg font-semibold" style={{ color: 'var(--brand)' }}>
                  {plan ? formatMoney(plan.pricePaise, plan.currency) : 'Free'}
                </span>
                {plan?.mrpPaise ? (
                  <span className="text-sm text-slate-400 line-through">
                    {formatMoney(plan.mrpPaise, plan.currency)}
                  </span>
                ) : null}
              </div>
            </article>
          );
        })}
        {courses.length === 0 && (
          <p className="text-sm text-slate-500">No published courses yet.</p>
        )}
      </div>
    </main>
  );
}
