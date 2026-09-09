import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { InstalmentRow, PlanForm } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function FeesPage() {
  const tenant = await requireTenant();
  await requireStaff('sales.fee_tracking', 'view');

  const now = new Date();

  const [plans, unpaid, withoutPlan] = await Promise.all([
    db.enrollment.findMany({
      where: { organizationId: tenant.organizationId, instalments: { some: {} } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        user: { select: { name: true, email: true, phone: true } },
        product: { select: { title: true } },
        instalments: { orderBy: { sequence: 'asc' } },
      },
    }),
    db.instalment.findMany({
      where: { enrollment: { organizationId: tenant.organizationId }, paidAt: null },
      select: { amountPaise: true, dueDate: true },
    }),
    db.enrollment.findMany({
      where: {
        organizationId: tenant.organizationId,
        status: 'ENROLLED',
        instalments: { none: {} },
        orderItemId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        user: { select: { name: true } },
        product: { select: { title: true } },
      },
    }),
  ]);

  const outstanding = unpaid.reduce((n, i) => n + i.amountPaise, 0);
  const overdue = unpaid.filter((i) => i.dueDate < now);
  const overdueValue = overdue.reduce((n, i) => n + i.amountPaise, 0);
  const dueSoon = unpaid.filter(
    (i) => i.dueDate >= now && i.dueDate < new Date(now.getTime() + 7 * 864e5),
  );

  return (
    <div>
      <PageHeader
        title="Fee tracking"
        description="Instalment plans and what is outstanding on them. A collected instalment is written as a payment, so cash at the counter moves the collections figure exactly like a card does."
      />

      <div className="space-y-6">
        <StatGrid>
          <Stat label="Outstanding" value={formatMoney(outstanding, tenant.currency)} sub={`${unpaid.length} instalments unpaid`} />
          <Stat
            label="Overdue"
            value={formatMoney(overdueValue, tenant.currency)}
            sub={`${overdue.length} past their due date`}
          />
          <Stat label="Due this week" value={String(dueSoon.length)} sub="worth a reminder call" />
          <Stat label="Plans running" value={String(plans.length)} />
        </StatGrid>

        {plans.length === 0 ? (
          <EmptyState
            title="No instalment plans yet"
            hint="Split a fee for a learner who is paying in parts. Everything else stays a single payment."
          />
        ) : (
          <div className="space-y-3">
            {plans.map((p) => {
              const total = p.instalments.reduce((n, i) => n + i.amountPaise, 0);
              const paid = p.instalments
                .filter((i) => i.paidAt)
                .reduce((n, i) => n + i.amountPaise, 0);
              const late = p.instalments.some((i) => !i.paidAt && i.dueDate < now);

              return (
                <Card key={p.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{p.user.name}</p>
                        {late && <Badge tone="bad">overdue</Badge>}
                        {paid >= total && <Badge tone="ok">paid up</Badge>}
                      </div>
                      <p className="t-small faint mt-1">
                        {p.product.title}
                        {p.user.phone ? ` · ${p.user.phone}` : p.user.email ? ` · ${p.user.email}` : ''}
                      </p>
                    </div>
                    <p className="t-small shrink-0 tabular-nums">
                      <span className="font-semibold">{formatMoney(paid, tenant.currency)}</span>
                      <span className="faint"> of {formatMoney(total, tenant.currency)}</span>
                    </p>
                  </div>

                  <ul className="mt-3 divide-y rounded-[var(--radius-sm)] border">
                    {p.instalments.map((i) => (
                      <InstalmentRow
                        key={i.id}
                        instalment={{
                          id: i.id,
                          sequence: i.sequence,
                          amount: formatMoney(i.amountPaise, tenant.currency),
                          dueDate: i.dueDate.toISOString(),
                          paid: Boolean(i.paidAt),
                        }}
                      />
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        )}

        {withoutPlan.length > 0 && (
          <Card>
            <h2 className="t-heading">Split a fee into instalments</h2>
            <p className="t-small muted mt-1">
              For a learner paying in parts. The remainder lands on the first instalment, so the
              parts always add back up to the total exactly.
            </p>
            <div className="mt-5">
              <PlanForm
                enrollments={withoutPlan.map((e) => ({
                  id: e.id,
                  label: `${e.user.name} · ${e.product.title}`,
                }))}
              />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
