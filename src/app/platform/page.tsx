import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getPlatformUser } from '@/lib/platform/session';
import { formatMoney } from '@/lib/money';
import { Badge, Card, PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { RunBillingButton } from './tenants/editors';

export const dynamic = 'force-dynamic';

const TONE: Record<string, 'ok' | 'brand' | 'warn' | 'bad' | 'neutral'> = { ACTIVE: 'ok', TRIALING: 'brand', PAST_DUE: 'warn', SUSPENDED: 'bad', CANCELLED: 'neutral', PENDING: 'neutral' };

/** The platform at a glance: how many academies, in what standing, and what they pay. */
export default async function PlatformHome() {
  const me = await getPlatformUser();
  if (!me) redirect('/platform/login');

  const [byStatus, subs, unpaid, recent] = await Promise.all([
    db.tenant.groupBy({ by: ['status'], _count: true }),
    db.tenantSubscription.findMany({ where: { status: 'ACTIVE' }, select: { amountPaise: true, billingCycle: true } }),
    db.tenantInvoice.aggregate({ where: { status: { in: ['DUE', 'OVERDUE'] } }, _sum: { totalPaise: true }, _count: true }),
    db.tenant.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, name: true, slug: true, status: true, createdAt: true, subscription: { select: { plan: { select: { name: true } } } } } }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const mrr = subs.reduce((n, s) => n + (s.billingCycle === 'ANNUAL' ? s.amountPaise / 12 : s.billingCycle === 'QUARTERLY' ? s.amountPaise / 3 : s.amountPaise), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Every academy on the platform, and what the platform earns from them." action={<RunBillingButton />} />
      <StatGrid>
        <Stat label="Academies" value={String(byStatus.reduce((n, b) => n + b._count, 0))} sub={`${count('ACTIVE')} active, ${count('TRIALING')} on trial`} />
        <Stat label="Monthly recurring" value={formatMoney(Math.round(mrr))} sub="from active subscriptions" />
        <Stat label="Unpaid invoices" value={formatMoney(unpaid._sum.totalPaise ?? 0)} sub={`${unpaid._count} invoice${unpaid._count === 1 ? '' : 's'}`} />
        <Stat label="Needing attention" value={String(count('PAST_DUE') + count('SUSPENDED'))} sub={`${count('PAST_DUE')} past due, ${count('SUSPENDED')} paused`} />
      </StatGrid>
      <Card>
        <div className="flex items-center justify-between gap-2">
          <h2 className="t-heading">Newest academies</h2>
          <Link href="/platform/tenants" className="t-small underline">All academies</Link>
        </div>
        <ul className="mt-3 divide-y">
          {recent.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div>
                <Link href={`/platform/tenants/${t.id}`} className="font-medium hover:underline">{t.name}</Link>
                <p className="t-small faint">{t.slug} · {t.subscription?.plan.name ?? 'no plan'} · joined {t.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
              <Badge tone={TONE[t.status] ?? 'neutral'}>{t.status.toLowerCase().replace('_', ' ')}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
