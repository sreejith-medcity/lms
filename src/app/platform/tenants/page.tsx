import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getPlatformUser } from '@/lib/platform/session';
import { formatMoney } from '@/lib/money';
import { Badge, Card, Cell, PageHeader, Row, Table } from '@/components/ui';
import { NewTenantForm } from './editors';

export const dynamic = 'force-dynamic';

const TONE: Record<string, 'ok' | 'brand' | 'warn' | 'bad' | 'neutral'> = { ACTIVE: 'ok', TRIALING: 'brand', PAST_DUE: 'warn', SUSPENDED: 'bad', CANCELLED: 'neutral', PENDING: 'neutral' };

export default async function TenantsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await getPlatformUser();
  if (!me) redirect('/platform/login');
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const status = typeof sp.status === 'string' ? sp.status : '';

  const [tenants, plans] = await Promise.all([
    db.tenant.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }, { ownerEmail: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, name: true, slug: true, status: true, ownerEmail: true, trialEndsAt: true, createdAt: true, subscription: { select: { amountPaise: true, billingCycle: true, currentPeriodEnd: true, plan: { select: { name: true } } } }, _count: { select: { invoices: { where: { status: { in: ['DUE', 'OVERDUE'] } } } } } },
    }),
    db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { code: true, name: true } }),
  ]);
  const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-6">
      <PageHeader title="Academies" description="Every tenant, their plan and their standing. Open one to change any of it." />
      <form action="/platform/tenants" method="get" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Name, address or owner email" className="rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-1.5 text-sm" />
        <select name="status" defaultValue={status} className="rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 py-1.5 text-sm">
          <option value="">Any standing</option>
          {['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>{s.toLowerCase().replace('_', ' ')}</option>
          ))}
        </select>
        <button type="submit" className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">Filter</button>
      </form>

      <Card padded={false}>
        <Table head={['Academy', 'Plan', 'Standing', 'Period ends', 'Unpaid', 'Joined']}>
          {tenants.map((t) => (
            <Row key={t.id}>
              <Cell>
                <Link href={`/platform/tenants/${t.id}`} className="font-medium hover:underline">{t.name}</Link>
                <span className="t-small faint block">{t.slug} · {t.ownerEmail}</span>
              </Cell>
              <Cell>{t.subscription ? `${t.subscription.plan.name} · ${formatMoney(t.subscription.amountPaise)} ${t.subscription.billingCycle.toLowerCase()}` : <span className="faint">none</span>}</Cell>
              <Cell><Badge tone={TONE[t.status] ?? 'neutral'}>{t.status.toLowerCase().replace('_', ' ')}</Badge></Cell>
              <Cell className="tabular-nums">{t.subscription ? day(t.subscription.currentPeriodEnd) : '—'}</Cell>
              <Cell className="tabular-nums">{t._count.invoices > 0 ? <span className="text-[var(--bad)]">{t._count.invoices}</span> : <span className="faint">—</span>}</Cell>
              <Cell className="tabular-nums">{day(t.createdAt)}</Cell>
            </Row>
          ))}
        </Table>
      </Card>

      <Card>
        <h2 className="t-heading">Create an academy by hand</h2>
        <p className="t-small muted mt-1">For a customer signed on the phone. Self-serve signups come in through /platform/start.</p>
        <div className="mt-4"><NewTenantForm plans={plans} /></div>
      </Card>
    </div>
  );
}
