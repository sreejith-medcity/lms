import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getPlatformUser } from '@/lib/platform/session';
import { formatMoney } from '@/lib/money';
import { measureUsage, limitsFor } from '@/lib/platform/billing';
import { METRIC_LABEL, metricValue } from '@/lib/platform/billing-rules';
import { Badge, Card, Cell, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { DomainControls, InvoiceControls, PlanControls, StandingControls } from '../editors';

export const dynamic = 'force-dynamic';

const TONE: Record<string, 'ok' | 'brand' | 'warn' | 'bad' | 'neutral'> = { ACTIVE: 'ok', TRIALING: 'brand', PAST_DUE: 'warn', SUSPENDED: 'bad', CANCELLED: 'neutral', PENDING: 'neutral', PAID: 'ok', DUE: 'warn', OVERDUE: 'bad', VOID: 'neutral' };

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getPlatformUser();
  if (!me) redirect('/platform/login');
  const { id } = await params;
  const t = await db.tenant.findUnique({
    where: { id },
    select: {
      id: true, name: true, slug: true, status: true, ownerEmail: true, ownerName: true, ownerPhone: true, trialEndsAt: true, suspendedAt: true, suspendReason: true, createdAt: true,
      subscription: { select: { planId: true, billingCycle: true, amountPaise: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, nextPlanId: true, plan: { select: { name: true } } } },
      domains: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { hostname: true, isPrimary: true, isCustom: true, sslStatus: true } },
      invoices: { orderBy: { periodStart: 'desc' }, take: 24, select: { id: true, invoiceNo: true, periodStart: true, periodEnd: true, totalPaise: true, status: true, dueDate: true, paidAt: true, paidReference: true } },
      provisionJobs: { orderBy: { startedAt: 'asc' }, select: { step: true, status: true, error: true } },
      organizations: { take: 1, select: { id: true, _count: { select: { users: true } } } },
    },
  });
  if (!t) notFound();
  const plans = await db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } });
  const [usage, limits] = await Promise.all([measureUsage(t.id), t.subscription ? limitsFor(t.subscription.planId, t.id) : Promise.resolve([])]);
  const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const failed = t.provisionJobs.filter((j) => j.status === 'FAILED');
  const canWrite = me.role !== 'READ_ONLY';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.name}
        description={`${t.slug} · ${t.ownerName ?? ''} ${t.ownerEmail}${t.ownerPhone ? ` · ${t.ownerPhone}` : ''} · joined ${day(t.createdAt)}`}
        action={<Link href="/platform/tenants" className="t-small underline">All academies</Link>}
      />
      {failed.length > 0 && (
        <Card className="border-[var(--bad)]">
          <p className="t-small font-medium text-[var(--bad)]">Provisioning did not finish: {failed.map((f) => `${f.step} (${f.error})`).join('; ')}</p>
        </Card>
      )}
      <StatGrid>
        <Stat label="Standing" value={t.status.toLowerCase().replace('_', ' ')} sub={t.status === 'SUSPENDED' ? t.suspendReason ?? undefined : t.trialEndsAt ? `trial ends ${day(t.trialEndsAt)}` : undefined} />
        <Stat label="Plan" value={t.subscription?.plan.name ?? 'none'} sub={t.subscription ? `${formatMoney(t.subscription.amountPaise)} ${t.subscription.billingCycle.toLowerCase()}${t.subscription.nextPlanId ? ', changing at renewal' : ''}${t.subscription.cancelAtPeriodEnd ? ', cancels at period end' : ''}` : undefined} />
        <Stat label="Period" value={t.subscription ? day(t.subscription.currentPeriodEnd) : '—'} sub={t.subscription ? `from ${day(t.subscription.currentPeriodStart)}` : undefined} />
        <Stat label="People" value={String(t.organizations[0]?._count.users ?? 0)} sub="accounts on the academy" />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="t-heading">Standing</h2>
          <div className="mt-3">{canWrite ? <StandingControls id={t.id} status={t.status} /> : <p className="t-small muted">Read only.</p>}</div>
        </Card>
        <Card>
          <h2 className="t-heading">Plan</h2>
          <div className="mt-3">{canWrite && t.subscription ? <PlanControls id={t.id} plans={plans} currentPlanId={t.subscription.planId} currentCycle={t.subscription.billingCycle} /> : <p className="t-small muted">No subscription.</p>}</div>
        </Card>
      </div>

      <Card>
        <h2 className="t-heading">Usage against the plan</h2>
        <div className="mt-3">
          <Table head={['Metric', 'Now', 'Included', 'Hard cap', 'Overage']}>
            {usage.map((u) => {
              const l = limits.find((x) => x.metric === u.metric);
              return (
                <Row key={u.metric}>
                  <Cell>{METRIC_LABEL[u.metric] ?? u.metric}</Cell>
                  <Cell className="tabular-nums">{metricValue(u.metric, u.quantity)}</Cell>
                  <Cell className="tabular-nums">{l ? metricValue(u.metric, l.included) : '—'}</Cell>
                  <Cell className="tabular-nums">{l?.hardCap != null ? metricValue(u.metric, l.hardCap) : <span className="faint">none</span>}</Cell>
                  <Cell className="tabular-nums">{l && l.overagePaisePerUnit > 0 ? `${formatMoney(l.overagePaisePerUnit)} per unit` : <span className="faint">—</span>}</Cell>
                </Row>
              );
            })}
          </Table>
        </div>
      </Card>

      <Card>
        <h2 className="t-heading">Domains</h2>
        <div className="mt-3">{canWrite ? <DomainControls id={t.id} domains={t.domains} /> : <ul>{t.domains.map((d) => <li key={d.hostname} className="font-mono text-sm">{d.hostname}</li>)}</ul>}</div>
      </Card>

      <Card>
        <h2 className="t-heading">Invoices</h2>
        {t.invoices.length === 0 ? (
          <p className="t-small faint mt-2">None yet.</p>
        ) : (
          <div className="mt-3">
            <Table head={['Invoice', 'Period', 'Total', 'Due', 'Status', '']}>
              {t.invoices.map((i) => (
                <Row key={i.id}>
                  <Cell className="font-mono">{i.invoiceNo}</Cell>
                  <Cell className="tabular-nums">{day(i.periodStart)} to {day(i.periodEnd)}</Cell>
                  <Cell className="tabular-nums">{formatMoney(i.totalPaise)}</Cell>
                  <Cell className="tabular-nums">{day(i.dueDate)}</Cell>
                  <Cell><Badge tone={TONE[i.status] ?? 'neutral'}>{i.status.toLowerCase()}</Badge>{i.paidAt && <span className="t-micro faint block">{day(i.paidAt)}{i.paidReference ? ` · ${i.paidReference}` : ''}</span>}</Cell>
                  <Cell>{canWrite && <InvoiceControls invoiceId={i.id} status={i.status} />}</Cell>
                </Row>
              ))}
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
