import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Card } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { ColumnChart, type ColumnPoint } from '@/components/chart';
import { Breakdown, Definitions } from '@/components/analytics-bits';
import { rangeFrom, salesData } from './data';

export const dynamic = 'force-dynamic';

export default async function SalesAnalytics({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireTenant();
  await requireStaff('analytics.manage_analytics', 'view');

  const sp = await searchParams;
  const { since, days, label } = rangeFrom(
    (Array.isArray(sp.range) ? sp.range[0] : sp.range) as string | undefined,
  );

  const d = await salesData(tenant.organizationId, since, days);

  const chart: ColumnPoint[] = d.series.map((b) => ({
    label: b.start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    axisLabel: b.start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    value: b.value / 100,
    display: formatMoney(b.value, tenant.currency),
  }));

  const topCourse = d.byCourse[0]?.paise ?? 1;
  const topMethod = d.methods[0]?.[1] ?? 1;

  return (
    <div className="space-y-6">
      <StatGrid>
        <Stat label="Collected" value={formatMoney(d.collected, tenant.currency)} sub={label.toLowerCase()} />
        <Stat
          label="Outstanding"
          value={formatMoney(d.outstanding, tenant.currency)}
          sub="checkouts started, never paid"
        />
        <Stat label="Refunded" value={formatMoney(d.refunded, tenant.currency)} sub={label.toLowerCase()} />
        <Stat
          label="Checkout conversion"
          value={`${d.conversion}%`}
          sub={`${d.paid} paid of ${d.started} started`}
        />
      </StatGrid>

      <Card>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="t-heading">Collections</h2>
          <span className="t-small faint">{label.toLowerCase()}</span>
        </div>
        <ColumnChart points={chart} emptyMessage="No payments arrived in this period." />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown
          title="By course"
          empty="No paid orders in this period."
          rows={d.byCourse.map((c) => ({
            label: c.title,
            value: formatMoney(c.paise, tenant.currency),
            ratio: (c.paise / topCourse) * 100,
            sub: `${c.orders} order${c.orders === 1 ? '' : 's'}`,
          }))}
        />

        <Breakdown
          title="By payment method"
          empty="Nothing received in this period."
          rows={d.methods.map(([method, paise]) => ({
            label: method,
            value: formatMoney(paise, tenant.currency),
            ratio: (paise / topMethod) * 100,
          }))}
        />
      </div>

      <Definitions
        items={[
          [
            'Collected',
            'Money that actually arrived and was confirmed by the gateway or recorded at the counter, in this period. Not what was invoiced, and not recognised revenue for accounting.',
          ],
          [
            'Outstanding',
            'The value of orders where a checkout was started and never paid. It is a follow-up list, not an asset.',
          ],
          [
            'Refunded',
            'Refunds processed in this period, regardless of when the original payment came in, so it will not always reconcile against collections for the same window.',
          ],
          [
            'Checkout conversion',
            'Orders marked paid as a share of orders started in this period. An order started on the last day and paid tomorrow counts as unpaid here.',
          ],
          [
            'By course',
            'The paid value of order lines, so a bundle of two courses is split between them rather than credited twice.',
          ],
        ]}
      />
    </div>
  );
}
