import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { Stat } from '@/components/stat';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

/**
 * Platform control plane. Reached on the PLATFORM_HOST only; tenant sessions
 * never resolve here.
 */
export default async function PlatformHome() {
  // Phase 0 has no platform auth yet, so the only gate is the hostname. Until
  // PLATFORM_HOST is set to a dedicated subdomain, this route stays closed.
  const host = ((await headers()).get('host') ?? '').split(':')[0].toLowerCase();
  const platformHost = (process.env.PLATFORM_HOST ?? '').split(':')[0].toLowerCase();
  if (!platformHost || host !== platformHost) notFound();

  const [tenants, active, trialing, subs] = await Promise.all([
    db.tenant.count(),
    db.tenant.count({ where: { status: 'ACTIVE' } }),
    db.tenant.count({ where: { status: 'TRIALING' } }),
    db.tenantSubscription.findMany({
      where: { status: 'ACTIVE' },
      include: { tenant: true, plan: true },
    }),
  ]);

  const mrrPaise = subs.reduce((sum, s) => {
    const perMonth =
      s.billingCycle === 'ANNUAL'
        ? s.amountPaise / 12
        : s.billingCycle === 'QUARTERLY'
          ? s.amountPaise / 3
          : s.amountPaise;
    return sum + perMonth;
  }, 0);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <h1 className="text-xl font-semibold">Platform</h1>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Tenants" value={tenants} />
        <Stat label="Active" value={active} />
        <Stat label="Trialing" value={trialing} />
        <Stat label="MRR" value={formatMoney(Math.round(mrrPaise))} />
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)] text-left faint">
            <tr>
              <th className="p-3">Tenant</th>
              <th className="p-3">Plan</th>
              <th className="p-3">Cycle</th>
              <th className="p-3">Amount</th>
              <th className="p-3">Renews</th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-3 font-medium">{s.tenant.name}</td>
                <td className="p-3">{s.plan.name}</td>
                <td className="p-3">{s.billingCycle}</td>
                <td className="p-3">{formatMoney(s.amountPaise)}</td>
                <td className="p-3">{s.currentPeriodEnd.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
            {subs.length === 0 && (
              <tr>
                <td className="p-6 text-center faint" colSpan={5}>
                  No active subscriptions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
