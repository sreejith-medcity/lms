import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

interface TaxBreakup {
  taxableValue?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  total?: number;
}

export default async function InvoicesPage() {
  const tenant = await requireTenant();
  await requireStaff('sales.payments', 'view');

  const invoices = await db.invoice.findMany({
    where: { order: { organizationId: tenant.organizationId } },
    orderBy: { issuedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      invoiceNo: true,
      issuedAt: true,
      taxBreakup: true,
      placeOfSupply: true,
      order: {
        select: {
          orderNo: true,
          currency: true,
          subtotalPaise: true,
          taxPaise: true,
          totalPaise: true,
          status: true,
          user: { select: { name: true } },
          items: { select: { id: true, titleSnapshot: true } },
        },
      },
    },
  });

  const taxable = invoices.reduce((n, i) => n + i.order.subtotalPaise, 0);
  const tax = invoices.reduce((n, i) => n + i.order.taxPaise, 0);
  const gross = invoices.reduce((n, i) => n + i.order.totalPaise, 0);

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Numbered in one unbroken sequence, issued the moment an order is paid, and never edited afterwards. An invoice that can change is not an invoice."
      />

      <div className="space-y-6">
        <StatGrid>
          <Stat label="Invoices" value={String(invoices.length)} sub="most recent 100" />
          <Stat label="Taxable value" value={formatMoney(taxable, tenant.currency)} />
          <Stat label="Tax" value={formatMoney(tax, tenant.currency)} sub="CGST plus SGST" />
          <Stat label="Gross" value={formatMoney(gross, tenant.currency)} />
        </StatGrid>

        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            hint="One is issued automatically the moment an order is paid, online or at the counter."
          />
        ) : (
          <Table
            head={['Invoice', 'Date', 'Learner', 'Course', 'Taxable', 'Tax', 'Total']}
          >
            {invoices.map((i) => {
              const breakup = (i.taxBreakup ?? {}) as TaxBreakup;
              return (
                <Row key={i.id}>
                  <Cell>
                    <span className="font-mono text-xs font-medium">{i.invoiceNo}</span>
                    <span className="t-small faint block">{i.order.orderNo}</span>
                  </Cell>
                  <Cell className="t-small faint">
                    {i.issuedAt.toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Cell>
                  <Cell className="t-small">{i.order.user.name}</Cell>
                  <Cell className="t-small">
                    {i.order.items.map((it) => it.titleSnapshot).join(', ')}
                  </Cell>
                  <Cell className="tabular-nums">
                    {formatMoney(i.order.subtotalPaise, i.order.currency)}
                  </Cell>
                  <Cell className="t-small tabular-nums">
                    {formatMoney(i.order.taxPaise, i.order.currency)}
                    {breakup.cgst != null && breakup.sgst != null && (
                      <span className="faint block">
                        {formatMoney(breakup.cgst)} + {formatMoney(breakup.sgst)}
                      </span>
                    )}
                  </Cell>
                  <Cell className="font-medium tabular-nums">
                    {formatMoney(i.order.totalPaise, i.order.currency)}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}

        <p className="t-small faint">
          PDF copies are not generated yet. Place of supply comes from the tax settings, so an
          out-of-state sale is currently invoiced as intra-state until checkout collects a billing
          address.
        </p>
      </div>
    </div>
  );
}
