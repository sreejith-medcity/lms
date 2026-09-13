import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { limitsFor, measureUsage } from '@/lib/platform/billing';
import { METRIC_LABEL, metricValue } from '@/lib/platform/billing-rules';
import { Badge, Card, Cell, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { CancelControl, PayInvoiceButton, PlanChooser } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const TONE: Record<string, 'ok' | 'brand' | 'warn' | 'bad' | 'neutral'> = { PAID: 'ok', DUE: 'warn', OVERDUE: 'bad', VOID: 'neutral' };

/**
 * What the academy is on, what it uses, what it owes. The one settings
 * page that is about the academy's relationship with the platform rather
 * than with its learners.
 */
export default async function BillingPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.organization', 'view');
  const canEdit = me.permissions['settings.organization']?.edit ?? false;

  const [row, plans, invoices, usage] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenant.tenantId }, select: { status: true, trialEndsAt: true, suspendReason: true, subscription: { select: { planId: true, billingCycle: true, amountPaise: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, nextPlanId: true, nextBillingCycle: true, plan: { select: { code: true, name: true } } } } } }),
    db.plan.findMany({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: 'asc' }, select: { code: true, name: true, monthlyPaise: true, quarterlyPaise: true, annualPaise: true, id: true } }),
    db.tenantInvoice.findMany({ where: { tenantId: tenant.tenantId, status: { not: 'VOID' } }, orderBy: { periodStart: 'desc' }, take: 24, select: { id: true, invoiceNo: true, periodStart: true, periodEnd: true, totalPaise: true, status: true, dueDate: true, paidAt: true, lineItems: true } }),
    measureUsage(tenant.tenantId),
  ]);
  const sub = row?.subscription ?? null;
  const limits = sub ? await limitsFor(sub.planId, tenant.tenantId) : [];
  const nextPlan = sub?.nextPlanId ? plans.find((p) => p.id === sub.nextPlanId) : null;
  const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const unpaid = invoices.filter((i) => i.status === 'DUE' || i.status === 'OVERDUE');

  return (
    <div className="space-y-6">
      {row?.status === 'SUSPENDED' && (
        <Card className="border-[var(--bad)]">
          <p className="font-medium text-[var(--bad)]">The academy is paused{row.suspendReason ? `: ${row.suspendReason}` : ''}.</p>
          <p className="t-small muted mt-1">Learners cannot sign in until it is settled. Paying the open invoice below puts it back at once.</p>
        </Card>
      )}
      {row?.status === 'PAST_DUE' && (
        <Card className="border-[var(--warn)]">
          <p className="font-medium">An invoice is past due.</p>
          <p className="t-small muted mt-1">Everything keeps working for now; the academy is paused if it stays unpaid for two weeks past the due date.</p>
        </Card>
      )}

      <StatGrid>
        <Stat label="Plan" value={sub?.plan.name ?? 'None'} sub={sub ? `${formatMoney(sub.amountPaise)} ${sub.billingCycle.toLowerCase()}` : undefined} />
        <Stat label="Standing" value={(row?.status ?? '').toLowerCase().replace('_', ' ')} sub={row?.trialEndsAt ? `trial ends ${day(row.trialEndsAt)}` : sub?.cancelAtPeriodEnd ? 'closing at period end' : undefined} />
        <Stat label="Current period" value={sub ? day(sub.currentPeriodEnd) : '—'} sub={sub ? `from ${day(sub.currentPeriodStart)}` : undefined} />
        <Stat label="Owed" value={formatMoney(unpaid.reduce((n, i) => n + i.totalPaise, 0))} sub={unpaid.length ? `${unpaid.length} invoice${unpaid.length === 1 ? '' : 's'} open` : 'nothing open'} />
      </StatGrid>

      {unpaid.length > 0 && (
        <Card>
          <h2 className="t-heading">To pay</h2>
          <ul className="mt-3 divide-y">
            {unpaid.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">{i.invoiceNo} · {formatMoney(i.totalPaise)}</p>
                  <p className="t-small faint">{day(i.periodStart)} to {day(i.periodEnd)} · due {day(i.dueDate)}</p>
                </div>
                {canEdit && <PayInvoiceButton invoiceId={i.id} academyName={tenant.name} brandColor={tenant.brandColor} payerName={me.name} payerEmail={me.email} />}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="t-heading">Plan</h2>
        <p className="t-small muted mt-1">
          {nextPlan ? `Changing to ${nextPlan.name}, ${sub?.nextBillingCycle?.toLowerCase()}, at the next renewal.` : 'A change takes effect at the next renewal, so nothing is charged twice for the same month.'}
        </p>
        <div className="mt-4">
          {sub ? (
            <PlanChooser
              plans={plans.map((p) => ({ code: p.code, name: p.name, monthlyLabel: formatMoney(p.monthlyPaise), quarterlyLabel: p.quarterlyPaise ? formatMoney(p.quarterlyPaise) : null, annualLabel: p.annualPaise ? formatMoney(p.annualPaise) : null }))}
              currentCode={sub.plan.code}
              currentCycle={sub.billingCycle}
              canEdit={canEdit}
            />
          ) : (
            <p className="t-small faint">No subscription is attached to this academy. Ask the platform team.</p>
          )}
        </div>
        {sub && canEdit && (
          <div className="mt-4">
            <CancelControl cancelAtPeriodEnd={sub.cancelAtPeriodEnd} />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="t-heading">Usage</h2>
        <p className="t-small muted mt-1">Against what the plan includes. Overage, where the plan has it, is billed at the next renewal on the month's highest figure.</p>
        <div className="mt-3">
          <Table head={['', 'Now', 'Included', 'Over']}>
            {usage.map((u) => {
              const l = limits.find((x) => x.metric === u.metric);
              const over = l ? Math.max(0, u.quantity - l.included) : 0;
              return (
                <Row key={u.metric}>
                  <Cell>{METRIC_LABEL[u.metric] ?? u.metric}</Cell>
                  <Cell className="tabular-nums">{metricValue(u.metric, u.quantity)}</Cell>
                  <Cell className="tabular-nums">{l ? metricValue(u.metric, l.included) : <span className="faint">no limit</span>}</Cell>
                  <Cell className="tabular-nums">{over > 0 ? <span className="text-[var(--warn)]">{metricValue(u.metric, over)}{l && l.overagePaisePerUnit > 0 ? ` · ${formatMoney(over * l.overagePaisePerUnit)}` : l?.hardCap != null ? ' · at the cap' : ''}</span> : <span className="faint">—</span>}</Cell>
                </Row>
              );
            })}
          </Table>
        </div>
      </Card>

      <Card>
        <h2 className="t-heading">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="t-small faint mt-2">None yet. The first comes when the trial ends.</p>
        ) : (
          <div className="mt-3">
            <Table head={['Invoice', 'Period', 'Total', 'Status']}>
              {invoices.map((i) => (
                <Row key={i.id}>
                  <Cell className="font-mono">{i.invoiceNo}</Cell>
                  <Cell className="tabular-nums">{day(i.periodStart)} to {day(i.periodEnd)}</Cell>
                  <Cell className="tabular-nums">{formatMoney(i.totalPaise)}</Cell>
                  <Cell><Badge tone={TONE[i.status] ?? 'neutral'}>{i.status.toLowerCase()}</Badge>{i.paidAt && <span className="t-micro faint block">paid {day(i.paidAt)}</span>}</Cell>
                </Row>
              ))}
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
