import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { OfflineRefundForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function RefundsPage() {
  const tenant = await requireTenant();
  await requireStaff('sales.refunds', 'view');

  const [refunds, refundable] = await Promise.all([
    db.refund.findMany({
      where: { payment: { organizationId: tenant.organizationId } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        amountPaise: true,
        reason: true,
        status: true,
        createdAt: true,
        payment: {
          select: {
            gateway: true,
            gatewayRef: true,
            currency: true,
            order: { select: { orderNo: true, user: { select: { name: true } } } },
          },
        },
      },
    }),
    // Only what this screen can act on: money taken outside the gateway.
    db.payment.findMany({
      where: {
        organizationId: tenant.organizationId,
        status: 'CAPTURED',
        gateway: { not: 'RAZORPAY' },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        amountPaise: true,
        currency: true,
        method: true,
        createdAt: true,
        order: { select: { orderNo: true } },
        userId: true,
      },
    }),
  ]);

  const users = await db.user.findMany({
    where: { id: { in: refundable.map((p) => p.userId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const total = refunds.reduce((n, r) => n + r.amountPaise, 0);

  return (
    <div>
      <PageHeader
        title="Refunds"
        description="What has been refunded and why. Gateway refunds are issued in Razorpay and arrive here through the webhook; this screen records the offline ones."
      />

      <div className="space-y-6">
        <StatGrid>
          <Stat label="Refunded" value={formatMoney(total, tenant.currency)} sub="all time" />
          <Stat label="Refunds" value={String(refunds.length)} />
          <Stat
            label="Gateway"
            value={String(refunds.filter((r) => r.payment.gateway === 'RAZORPAY').length)}
            sub="issued in Razorpay"
          />
          <Stat
            label="Offline"
            value={String(refunds.filter((r) => r.payment.gateway !== 'RAZORPAY').length)}
            sub="recorded here"
          />
        </StatGrid>

        {refunds.length === 0 ? (
          <EmptyState title="Nothing refunded" hint="Refunds appear here whichever way they were made." />
        ) : (
          <Table head={['Order', 'Learner', 'Amount', 'Where', 'Reason', 'When']}>
            {refunds.map((r) => (
              <Row key={r.id}>
                <Cell className="t-small">{r.payment.order?.orderNo ?? '—'}</Cell>
                <Cell className="t-small">{r.payment.order?.user.name ?? '—'}</Cell>
                <Cell className="tabular-nums">
                  {formatMoney(r.amountPaise, r.payment.currency)}
                </Cell>
                <Cell>
                  <Badge tone={r.payment.gateway === 'RAZORPAY' ? 'neutral' : 'warn'}>
                    {r.payment.gateway === 'RAZORPAY' ? 'gateway' : 'offline'}
                  </Badge>
                </Cell>
                <Cell className="t-small muted">{r.reason ?? '—'}</Cell>
                <Cell className="t-small faint">
                  {r.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </Cell>
              </Row>
            ))}
          </Table>
        )}

        <Card>
          <h2 className="t-heading">Record an offline refund</h2>
          <p className="t-small muted mt-1 max-w-prose">
            Cash handed back, a bank transfer, a cheque. This moves no money: it writes down money
            that already moved, so the collections figure does not overstate itself.
          </p>
          <p className="t-small faint mt-2 max-w-prose">
            A card payment taken through Razorpay is refunded in the Razorpay dashboard, where the
            controls and the confirmation step already exist. The webhook brings the result back
            here and ends the learner&rsquo;s access, leaving their progress and attendance intact.
          </p>

          <div className="mt-5">
            <OfflineRefundForm
              payments={refundable.map((p) => ({
                id: p.id,
                label: `${p.order?.orderNo ?? 'No order'} · ${nameOf.get(p.userId ?? '') ?? 'Unknown'} · ${formatMoney(p.amountPaise, p.currency)}${p.method ? ` · ${p.method}` : ''}`,
              }))}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
