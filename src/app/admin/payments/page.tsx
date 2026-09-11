import Link from 'next/link';
import { db } from '@/lib/db';
import { describeAttribution, parseAttributionValue } from '@/lib/attribution';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { RetryFulfilment } from './retry';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Money, and the things that went wrong with it.
 *
 * The refusals panel is the point of this page. A payment that succeeded at the
 * gateway but did not turn into an enrolment is the single worst state the
 * system can reach, and it used to exist only as a console line that the next
 * deploy erased. Now it is a row, with both numbers, so it can be answered.
 */
export default async function PaymentsPage() {
  const tenant = await requireTenant();
  await requireStaff('sales.payments', 'view');
  const orgId = tenant.organizationId;

  const [orders, payments, refusals, collected, pending] = await Promise.all([
    db.order.findMany({
      where: { organizationId: orgId },
      orderBy: { placedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        orderNo: true,
        status: true,
        totalPaise: true,
        currency: true,
        placedAt: true,
        gatewayOrderId: true,
        attribution: true,
        user: { select: { name: true, email: true } },
        items: { select: { id: true, titleSnapshot: true } },
        invoice: { select: { invoiceNo: true } },
        payments: { select: { id: true, status: true, method: true, gatewayRef: true } },
      },
    }),
    db.payment.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        status: true,
        method: true,
        amountPaise: true,
        currency: true,
        gatewayRef: true,
        failureReason: true,
        createdAt: true,
        orderId: true,
      },
    }),
    db.gatewayEvent.findMany({
      where: { organizationId: orgId, event: 'fulfilment.refused' },
      orderBy: { receivedAt: 'desc' },
      take: 10,
      select: { id: true, error: true, payload: true, receivedAt: true },
    }),
    db.payment.aggregate({
      where: { organizationId: orgId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } },
      _sum: { amountPaise: true },
      _count: true,
    }),
    db.order.aggregate({
      where: { organizationId: orgId, status: 'PENDING' },
      _sum: { totalPaise: true },
      _count: true,
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Every order and every payment, and anything that took money without granting access. Nothing here is ever deleted."
      />

      <div className="space-y-6">
        <StatGrid>
          <Stat
            label="Collected"
            value={formatMoney(collected._sum.amountPaise ?? 0, tenant.currency)}
            sub={`${collected._count} payment${collected._count === 1 ? '' : 's'}`}
          />
          <Stat
            label="Awaiting payment"
            value={formatMoney(pending._sum.totalPaise ?? 0, tenant.currency)}
            sub={`${pending._count} order${pending._count === 1 ? '' : 's'} started, not paid`}
          />
          <Stat label="Needs fixing" value={refusals.length} sub="paid but not enrolled" />
          <Stat label="Orders" value={orders.length} sub="most recent 50" />
        </StatGrid>

        {refusals.length > 0 && (
          <section>
            <h2 className="t-heading mb-3">Paid, but not enrolled</h2>
            <Card padded={false}>
              <ul className="divide-y">
                {refusals.map((r) => {
                  const p = (r.payload ?? {}) as Record<string, unknown>;
                  return (
                    <li key={r.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {String(p.orderNo ?? p.orderId ?? 'Unknown order')}
                            <Badge tone="bad">{r.error ?? 'refused'}</Badge>
                          </p>
                          <p className="t-small muted mt-1">{explain(r.error, p)}</p>
                          <p className="t-micro faint mt-1 font-mono">
                            payment {String(p.gatewayPaymentId ?? '—')}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <span className="t-small faint">
                            {r.receivedAt.toLocaleString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {/* Fix the cause, then finish the order from here
                              rather than from the database. */}
                          <RetryFulfilment
                            orderId={String(p.orderId ?? '')}
                            gatewayPaymentId={String(p.gatewayPaymentId ?? '')}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        )}

        <section>
          <h2 className="t-heading mb-3">Orders</h2>
          {orders.length === 0 ? (
            <EmptyState title="No orders yet" hint="They appear here the moment a checkout starts." />
          ) : (
            <Table head={['Order', 'Learner', 'Course', 'Status', 'Invoice', 'Amount']}>
              {orders.map((o) => (
                <Row key={o.id}>
                  <Cell>
                    <span className="font-medium">{o.orderNo}</span>
                    <span className="t-small faint block">
                      {o.placedAt.toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' · '}
                      {describeAttribution(parseAttributionValue(o.attribution))}
                    </span>
                  </Cell>
                  <Cell>
                    <span className="text-sm">{o.user.name}</span>
                    <span className="t-small faint block">{o.user.email ?? '—'}</span>
                  </Cell>
                  <Cell className="t-small">
                    {o.items.map((i) => i.titleSnapshot).join(', ') || '—'}
                  </Cell>
                  <Cell>
                    <Badge
                      tone={
                        o.status === 'PAID'
                          ? 'ok'
                          : o.status === 'PENDING'
                            ? 'warn'
                            : o.status === 'REFUNDED'
                              ? 'neutral'
                              : 'bad'
                      }
                    >
                      {o.status.toLowerCase().replace('_', ' ')}
                    </Badge>
                    {o.payments[0]?.method && (
                      <span className="t-micro faint block">{o.payments[0].method}</span>
                    )}
                  </Cell>
                  <Cell className="t-small tabular-nums">
                    {o.invoice?.invoiceNo ?? <span className="faint">—</span>}
                  </Cell>
                  <Cell className="tabular-nums">{formatMoney(o.totalPaise, o.currency)}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </section>

        <section>
          <h2 className="t-heading mb-3">Gateway payments</h2>
          {payments.length === 0 ? (
            <EmptyState
              title="Nothing received yet"
              hint="Every attempt lands here, successful or not, so money is never invisible."
            />
          ) : (
            <Table head={['Reference', 'Status', 'Method', 'Order', 'Amount']}>
              {payments.map((p) => (
                <Row key={p.id}>
                  <Cell className="font-mono text-xs">{p.gatewayRef ?? '—'}</Cell>
                  <Cell>
                    <Badge
                      tone={
                        p.status === 'CAPTURED' ? 'ok' : p.status === 'FAILED' ? 'bad' : 'neutral'
                      }
                    >
                      {p.status.toLowerCase().replace('_', ' ')}
                    </Badge>
                    {p.failureReason && (
                      <span className="t-micro faint block max-w-xs">{p.failureReason}</span>
                    )}
                  </Cell>
                  <Cell className="t-small">{p.method ?? '—'}</Cell>
                  <Cell className="t-small">
                    {p.orderId ? (
                      <span className="faint">linked</span>
                    ) : (
                      <Badge tone="warn">unmatched</Badge>
                    )}
                  </Cell>
                  <Cell className="tabular-nums">{formatMoney(p.amountPaise, p.currency)}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </section>

        <p className="t-small faint">
          Refunds are issued in the Razorpay dashboard. The webhook brings the result back here
          and expires the enrolment, leaving the learner&rsquo;s progress and attendance intact.{' '}
          <Link href="/admin/settings/integrations" className="underline">
            Check the webhook is connected
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function explain(reason: string | null, p: Record<string, unknown>): string {
  if (reason === 'AMOUNT_MISMATCH') {
    const gateway = Number(p.gatewayAmountPaise ?? 0);
    const order = Number(p.orderTotalPaise ?? 0);
    const difference = gateway - order;

    if (p.why === 'UNDERPAID') {
      return `The gateway took ${formatMoney(gateway)}, less than the ${formatMoney(order)} the order was for. Nothing was granted.`;
    }

    /*
     * The one overpayment with an ordinary explanation. An account set to
     * charge the gateway fee to the customer captures the order plus that
     * fee, which is about three and a half percent more. That is accepted
     * now when the gateway reports the fee, so a refusal here usually means
     * it did not, and the fix is one setting rather than a refund.
     */
    const feeShaped = difference > 0 && difference < order * 0.06;
    return `The gateway took ${formatMoney(gateway)} against an order priced at ${formatMoney(order)}, ${formatMoney(difference)} more. ${
      feeShaped
        ? 'That is the shape of a gateway fee charged to the customer. Check who bears the fee in the Razorpay dashboard, then press Try again.'
        : 'Access was not granted on a guess. Refund or enrol manually, whichever is right.'
    }`;
  }
  if (reason === 'ORDER_NOT_FOUND') {
    return 'The payment referenced an order this academy does not have. Usually a stale checkout page from before a database reset.';
  }
  if (reason === 'FULFILMENT_THREW') {
    return `Something failed while granting access: ${String(p.message ?? 'unknown')}`;
  }
  return 'The payment succeeded but enrolment did not complete.';
}
