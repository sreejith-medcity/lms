import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { balanceOf, daysOverdue, summariseAccount } from '@/lib/dues';
import { Badge, Card, EmptyState } from '@/components/ui';
import { PayInstalment } from './pay-instalment';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fees' };

const dateLabel = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The learner's side of the fee plan: what is paid, what is next, and a
 * button to pay it. Only the oldest open instalment gets the button, so
 * the schedule is settled in order whichever door the money comes through.
 */
export default async function FeesPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const plans = await db.enrollment.findMany({
    where: { organizationId: tenant.organizationId, userId: user.id, instalments: { some: {} } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      product: { select: { title: true } },
      instalments: {
        orderBy: { sequence: 'asc' },
        select: { id: true, sequence: true, amountPaise: true, paidPaise: true, dueDate: true, paidAt: true },
      },
    },
  });

  const receipts = await db.payment.findMany({
    where: { organizationId: tenant.organizationId, userId: user.id, receiptNo: { not: null }, status: 'CAPTURED' },
    orderBy: { capturedAt: 'desc' },
    take: 30,
    select: { id: true, receiptNo: true, amountPaise: true, capturedAt: true, createdAt: true, method: true, raw: true },
  });

  const now = new Date();

  return (
    <div className="mx-auto max-w-5xl px-5 py-7">
      <h1 className="text-xl font-semibold">Fees</h1>
      <p className="t-small faint mt-1">
        Your instalment plans, what is paid and what is coming up. Pay online here, or at the academy and
        the receipt appears below.
      </p>

      <div className="mt-6 space-y-4">
        {plans.length === 0 ? (
          <EmptyState
            title="No instalment plans"
            hint="Everything you have bought was paid in full. Purchases and invoices are under Purchases."
          />
        ) : (
          plans.map((plan) => {
            const summary = summariseAccount(plan.instalments, now);
            const next = plan.instalments.find((i) => balanceOf(i) > 0);
            return (
              <Card key={plan.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{plan.product.title}</p>
                      {summary.settled ? (
                        <Badge tone="ok">paid up</Badge>
                      ) : summary.overduePaise > 0 ? (
                        <Badge tone="bad">overdue</Badge>
                      ) : null}
                    </div>
                    <p className="t-small faint mt-1 tabular-nums">
                      {formatMoney(summary.paidPaise, tenant.currency)} paid of {formatMoney(summary.totalPaise, tenant.currency)}
                      {summary.balancePaise > 0 ? ` · ${formatMoney(summary.balancePaise, tenant.currency)} to go` : ''}
                    </p>
                  </div>
                  {next && (
                    <PayInstalment
                      instalmentId={next.id}
                      label={`Pay ${formatMoney(balanceOf(next), tenant.currency)} now`}
                    />
                  )}
                </div>

                <ul className="mt-4 divide-y rounded-[var(--radius-sm)] border">
                  {plan.instalments.map((i) => {
                    const balance = balanceOf(i);
                    const late = balance > 0 ? daysOverdue(i.dueDate, now) : 0;
                    return (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <span className="t-small faint tabular-nums">#{i.sequence}</span>
                          <span className="text-sm font-medium tabular-nums">{formatMoney(i.amountPaise, tenant.currency)}</span>
                          <span className={`t-small ${late > 0 ? 'text-[var(--bad)]' : 'faint'}`}>
                            {balance <= 0 ? `paid${i.paidAt ? ` ${dateLabel(i.paidAt)}` : ''}` : `due ${dateLabel(i.dueDate)}`}
                          </span>
                        </div>
                        <div className="t-small tabular-nums">
                          {balance <= 0 ? (
                            <Badge tone="ok">paid</Badge>
                          ) : i.paidPaise > 0 ? (
                            <span>{formatMoney(balance, tenant.currency)} left</span>
                          ) : late > 0 ? (
                            <Badge tone="bad">{late} {late === 1 ? 'day' : 'days'} late</Badge>
                          ) : (
                            <span className="faint">upcoming</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })
        )}

        {receipts.length > 0 && (
          <Card>
            <h2 className="t-heading">Receipts</h2>
            <ul className="mt-3 divide-y">
              {receipts.map((r) => {
                const raw = (r.raw ?? {}) as { item?: string };
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <Link href={`/learn/receipts/${r.receiptNo}`} className="font-medium tabular-nums underline">
                        {r.receiptNo}
                      </Link>
                      <span className="t-small faint block">
                        {raw.item ?? ''}{r.method ? ` · ${r.method}` : ''} · {dateLabel(r.capturedAt ?? r.createdAt)}
                      </span>
                    </div>
                    <span className="tabular-nums">{formatMoney(r.amountPaise, tenant.currency)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
