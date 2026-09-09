import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { formatDuration } from '@/lib/progress';
import { getTenantState } from '@/lib/tenant';
import { Badge, EmptyState, LinkButton } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const state = await getTenantState();
  if (state.status === 'setup-required') return <SetupNotice detail={state.detail} />;
  if (state.status === 'no-tenant') return <NoTenantNotice />;

  const tenant = state.tenant;
  const user = await getSessionUser();

  const products = await db.product.findMany({
    where: { organizationId: tenant.organizationId, type: 'COURSE', status: 'PUBLISHED', deletedAt: null },
    orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    take: 24,
    include: {
      course: {
        select: {
          description: true,
          level: true,
          modules: {
            select: {
              module: {
                select: { sections: { select: { materials: { select: { durationSeconds: true } } } } },
              },
            },
          },
        },
      },
      pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
    },
  });

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <header className="border-b bg-[var(--surface)]">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href="/" className="flex items-center gap-2">
            <span
              className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-xs font-bold"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              {tenant.name.slice(0, 1)}
            </span>
            <span className="t-heading truncate">{tenant.name}</span>
          </Link>

          <nav className="flex items-center gap-3">
            {user ? (
              <>
                <Link href="/learn" className="t-small muted hover:text-[var(--ink)]">
                  My learning
                </Link>
                {user.kind === 'STAFF' && (
                  <Link href="/admin" className="t-small muted hover:text-[var(--ink)]">
                    Admin
                  </Link>
                )}
                <a href="/logout" className="t-small muted hover:text-[var(--ink)]">
                  Sign out
                </a>
              </>
            ) : (
              <>
                <Link href="/login" className="t-small muted hover:text-[var(--ink)]">
                  Sign in
                </Link>
                <LinkButton href="/signup" size="sm">
                  Create account
                </LinkButton>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="border-b bg-[var(--surface)]">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h1 className="t-display max-w-2xl text-balance">
            Learn with {tenant.name}, live and at your own pace
          </h1>
          <p className="t-body muted mt-3 max-w-xl">
            Live classes with your trainer, recordings you can revisit, practice material and tests,
            all tracked in one place.
          </p>
        </div>
      </section>

      <main className="rise mx-auto max-w-6xl px-5 py-10">
        <h2 className="t-heading mb-4">Courses</h2>

        {products.length === 0 ? (
          <EmptyState
            title="No published courses yet"
            hint="Courses appear here as soon as the academy publishes them."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => {
              const plan = p.pricingPlans[0];
              const seconds =
                p.course?.modules.reduce(
                  (total, cm) =>
                    total +
                    cm.module.sections.reduce(
                      (s, sec) => s + sec.materials.reduce((m, mat) => m + (mat.durationSeconds ?? 0), 0),
                      0,
                    ),
                  0,
                ) ?? 0;

              const discount =
                plan?.mrpPaise && plan.mrpPaise > plan.pricePaise
                  ? Math.round(((plan.mrpPaise - plan.pricePaise) / plan.mrpPaise) * 100)
                  : null;

              return (
                <Link
                  key={p.id}
                  href={`/course/${p.slug}`}
                  className="group flex flex-col rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-sm transition hover:border-[var(--brand-line)] hover:shadow"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="t-heading">{p.title}</h3>
                    {discount && <Badge tone="ok">{discount}% off</Badge>}
                  </div>

                  <p className="t-small muted mt-2 line-clamp-2">{p.course?.description}</p>

                  <p className="t-small faint mt-3">
                    {[p.course?.level, seconds > 0 ? formatDuration(seconds) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>

                  <div className="mt-4 flex items-baseline gap-2 border-t pt-4">
                    <span className="text-lg font-semibold" style={{ color: 'var(--brand)' }}>
                      {plan ? formatMoney(plan.pricePaise, plan.currency) : 'Free'}
                    </span>
                    {plan?.mrpPaise ? (
                      <span className="t-small faint line-through">
                        {formatMoney(plan.mrpPaise, plan.currency)}
                      </span>
                    ) : null}
                    <span className="t-small ml-auto font-medium" style={{ color: 'var(--brand)' }}>
                      View →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="t-title">{title}</h1>
      <div className="t-body muted mt-4 space-y-3">{children}</div>
    </main>
  );
}

function SetupNotice({ detail }: { detail: string }) {
  return (
    <Shell title="Database not ready">
      <p>The app is running, but it cannot use its database yet. Usually one of:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <code>DATABASE_URL</code> is still a placeholder, or the password needs percent-encoding
        </li>
        <li>
          <code>?sslmode=require</code> is missing from the connection string
        </li>
        <li>
          The schema has not been created: run <code>npm run db:push</code> then{' '}
          <code>npm run db:seed</code>
        </li>
      </ul>
      <p className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 font-mono text-xs">{detail}</p>
    </Shell>
  );
}

function NoTenantNotice() {
  return (
    <Shell title="No academy on this hostname">
      <p>
        The database is reachable, but no tenant matches this address. Add the hostname as a
        TenantDomain row, or set <code>APP_HOSTNAME</code> and run the seed again.
      </p>
    </Shell>
  );
}
