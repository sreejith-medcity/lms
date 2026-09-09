import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { getTenantState } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const state = await getTenantState();

  if (state.status === 'setup-required') return <SetupNotice detail={state.detail} />;
  if (state.status === 'no-tenant') return <NoTenantNotice />;

  const tenant = state.tenant;
  const user = await getSessionUser();

  const courses = await db.product.findMany({
    where: { organizationId: tenant.organizationId, type: 'COURSE', status: 'PUBLISHED' },
    include: { course: true, pricingPlans: { where: { isActive: true }, take: 1 } },
    orderBy: { createdAt: 'desc' },
    take: 24,
  });

  return (
    <main className="mx-auto max-w-6xl p-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link href="/learn" className="text-slate-600 hover:underline">
                My learning
              </Link>
              {user.kind === 'STAFF' && (
                <Link href="/admin" className="text-slate-600 hover:underline">
                  Admin
                </Link>
              )}
              <a href="/logout" className="text-slate-600 hover:underline">
                Sign out
              </a>
            </>
          ) : (
            <>
              <Link href="/login" className="text-slate-600 hover:underline">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-lg px-3 py-2 font-medium text-white"
                style={{ background: 'var(--brand)' }}
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      <h2 className="mb-4 text-lg font-medium">Explore courses</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((p) => {
          const plan = p.pricingPlans[0];
          return (
            <Link
              key={p.id}
              href={`/course/${p.slug}`}
              className="block rounded-xl border bg-white p-5 transition hover:border-slate-300 hover:shadow-sm"
            >
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
            </Link>
          );
        })}
        {courses.length === 0 && (
          <p className="text-sm text-slate-500">No published courses yet.</p>
        )}
      </div>
    </main>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </main>
  );
}

/** Shown when the database cannot be reached, instead of a Next.js error digest. */
function SetupNotice({ detail }: { detail: string }) {
  return (
    <Shell title="Database not ready">
      <p>The app is running, but it cannot use its database yet. Usually one of:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <code>DATABASE_URL</code> is still a placeholder, or the password needs
          percent-encoding because it contains characters like <code>@</code>, <code>:</code>,
          <code>/</code> or <code>?</code>
        </li>
        <li>
          <code>?sslmode=require</code> is missing from the connection string
        </li>
        <li>
          The schema has not been created: run <code>npm run db:push</code> then{' '}
          <code>npm run db:seed</code>
        </li>
      </ul>
      <p className="rounded-lg bg-slate-100 p-3 font-mono text-xs text-slate-700">{detail}</p>
    </Shell>
  );
}

function NoTenantNotice() {
  return (
    <Shell title="No academy on this hostname">
      <p>
        The database is reachable, but no tenant matches this address. Add the hostname
        as a TenantDomain row, or set <code>APP_HOSTNAME</code> to it and run the seed
        again.
      </p>
    </Shell>
  );
}
