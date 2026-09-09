import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { dayKey, formatDayLabel, todayKey } from '@/lib/clock';
import { Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { Definitions } from '@/components/analytics-bits';
import { NewSettlement, RemoveSettlement } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * What the gateway actually paid into the bank.
 *
 * The number that matters is the one at the top right: money collected that
 * has not landed. Every other figure here is in service of explaining it.
 */
export default async function SettlementsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('sales.settlements', 'view');
  const canEdit = me.permissions['sales.settlements']?.edit ?? false;
  const tz = tenant.timezone;

  const [settlements, unsettled, collected] = await Promise.all([
    db.settlement.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { settledAt: 'desc' },
      take: 100,
      select: {
        id: true,
        gateway: true,
        gatewayRef: true,
        grossPaise: true,
        feePaise: true,
        taxPaise: true,
        netPaise: true,
        settledAt: true,
        _count: { select: { payments: true } },
      },
    }),
    db.payment.aggregate({
      where: {
        organizationId: tenant.organizationId,
        status: 'CAPTURED',
        settlementId: null,
        gateway: { notIn: ['CASH', 'MANUAL', 'CHEQUE'] },
      },
      _sum: { amountPaise: true },
      _count: true,
    }),
    db.payment.aggregate({
      where: { organizationId: tenant.organizationId, status: 'CAPTURED' },
      _sum: { amountPaise: true },
    }),
  ]);

  const gross = settlements.reduce((n, s) => n + s.grossPaise, 0);
  const fees = settlements.reduce((n, s) => n + s.feePaise + s.taxPaise, 0);
  const net = settlements.reduce((n, s) => n + s.netPaise, 0);
  const awaiting = unsettled._sum.amountPaise ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlements"
        description="Collections and settlements are different numbers. This is the one the bank agrees with."
      />

      <StatGrid>
        <Stat
          label="Not yet in the bank"
          value={formatMoney(awaiting, tenant.currency)}
          sub={`${unsettled._count} online payments unsettled`}
        />
        <Stat label="Settled" value={formatMoney(net, tenant.currency)} sub="net of fees, all time" />
        <Stat
          label="Gateway kept"
          value={formatMoney(fees, tenant.currency)}
          sub={gross > 0 ? `${((fees / gross) * 100).toFixed(2)}% of gross` : 'no settlements yet'}
        />
        <Stat
          label="Collected"
          value={formatMoney(collected._sum.amountPaise ?? 0, tenant.currency)}
          sub="every captured payment, online and offline"
        />
      </StatGrid>

      {settlements.length === 0 ? (
        <EmptyState
          title="No settlements entered"
          hint="Take the payout from the gateway's dashboard and enter it below. Razorpay's API does this on its own once integrations are connected."
        />
      ) : (
        <Table head={['Settled', 'Reference', 'Gross', 'Fee and tax', 'Net', 'Payments', '']}>
          {settlements.map((s) => (
            <Row key={s.id}>
              <Cell className="whitespace-nowrap">
                {formatDayLabel(dayKey(s.settledAt, tz), tz)}
                <p className="t-micro faint">{s.gateway.toLowerCase()}</p>
              </Cell>
              <Cell className="font-mono text-sm">{s.gatewayRef}</Cell>
              <Cell className="tabular-nums">{formatMoney(s.grossPaise, tenant.currency)}</Cell>
              <Cell className="tabular-nums">
                {formatMoney(s.feePaise + s.taxPaise, tenant.currency)}
              </Cell>
              <Cell className="tabular-nums font-medium">
                {formatMoney(s.netPaise, tenant.currency)}
              </Cell>
              <Cell className="tabular-nums">{s._count.payments}</Cell>
              <Cell className="text-right">
                {canEdit && <RemoveSettlement id={s.id} />}
              </Cell>
            </Row>
          ))}
        </Table>
      )}

      {canEdit && (
        <Card>
          <h2 className="t-heading">Enter a settlement</h2>
          <p className="t-small muted mt-1 max-w-prose">
            Copy the payout line from the gateway. Captured payments are attached oldest first until
            the gross is used up, and whatever is left over stays visibly unsettled rather than
            being quietly absorbed.
          </p>
          <div className="mt-4">
            <NewSettlement currency={tenant.currency} defaultDate={todayKey(tz)} />
          </div>
        </Card>
      )}

      <Definitions
        items={[
          [
            'Not yet in the bank',
            'Captured online payments with no settlement attached. Cash, cheque and manual payments are left out, since no gateway settles those.',
          ],
          ['Gateway kept', 'The fee plus GST on that fee, across every settlement entered, as a share of gross.'],
          ['Payments', 'How many captured payments this settlement was matched against, oldest first until the gross was used up.'],
        ]}
      />
    </div>
  );
}
