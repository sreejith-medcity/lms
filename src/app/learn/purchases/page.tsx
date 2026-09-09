import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { Badge, Cell, EmptyState, LinkButton, Row, Table } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Purchases' };

export default async function PurchasesPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const orders = await db.order.findMany({
    where: { organizationId: tenant.organizationId, userId: user.id },
    orderBy: { placedAt: 'desc' },
    take: 50,
    include: {
      items: { select: { id: true, titleSnapshot: true, productId: true } },
      invoice: { select: { invoiceNo: true, issuedAt: true } },
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { method: true, status: true, gatewayRef: true },
      },
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-5 py-7">
      <div>
      <h1 className="text-xl font-semibold">Purchases</h1>
      <p className="t-small faint mt-1">
        Every order, what you paid and its invoice number. Nothing here is ever deleted.
      </p>

      <div className="mt-6">
        {orders.length === 0 ? (
          <EmptyState
            title="No purchases yet"
            hint="Orders appear here as soon as you enrol in a paid course."
            action={<LinkButton href="/courses">Browse courses</LinkButton>}
          />
        ) : (
          <Table head={['Order', 'Course', 'Status', 'Invoice', 'Amount']}>
            {orders.map((o) => (
              <Row key={o.id}>
                <Cell>
                  <span className="font-medium">{o.orderNo}</span>
                  <span className="t-small faint block">
                    {o.placedAt.toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {o.payments[0]?.method ? ` · ${o.payments[0].method}` : ''}
                  </span>
                </Cell>
                <Cell>
                  {o.items.map((i) => (
                    <Link
                      key={i.id}
                      href={`/learn/${i.productId}`}
                      className="block hover:underline"
                    >
                      {i.titleSnapshot}
                    </Link>
                  ))}
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
                  {o.status === 'PENDING' && (
                    <Link href={`/checkout/${o.id}`} className="t-small block underline">
                      Complete payment
                    </Link>
                  )}
                </Cell>
                <Cell>
                  {o.invoice ? (
                    <span className="tabular-nums">{o.invoice.invoiceNo}</span>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </Cell>
                <Cell className="tabular-nums">{formatMoney(o.totalPaise, o.currency)}</Cell>
              </Row>
            ))}
          </Table>
        )}
        </div>
      </div>
    </div>
  );
}
