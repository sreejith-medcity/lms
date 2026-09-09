import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { sweepAbandonedCarts, ABANDON_AFTER_HOURS } from '@/lib/cart';
import { EmptyState, PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { Definitions } from '@/components/analytics-bits';
import { CartTable } from './table';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The people who nearly bought.
 *
 * Sorted by how many times they came back rather than by date, because someone
 * who reached checkout three times and stopped is a different conversation from
 * someone who wandered past once.
 */
export default async function CartsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('sales.abandoned_cart', 'view');
  const canEdit = me.permissions['sales.abandoned_cart']?.edit ?? false;

  // No scheduler yet, so carts are aged at the moment somebody looks at them.
  await sweepAbandonedCarts(tenant.organizationId);

  const carts = await db.cart.findMany({
    where: { organizationId: tenant.organizationId, status: { in: ['OPEN', 'ABANDONED'] } },
    orderBy: [{ visitCount: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      status: true,
      visitCount: true,
      updatedAt: true,
      abandonedAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
      items: {
        select: {
          id: true,
          product: {
            select: {
              id: true,
              title: true,
              pricingPlans: {
                where: { isActive: true },
                orderBy: { sortOrder: 'asc' },
                take: 1,
                select: { pricePaise: true, currency: true },
              },
            },
          },
        },
      },
    },
  });

  const converted = await db.cart.count({
    where: { organizationId: tenant.organizationId, status: 'CONVERTED' },
  });

  const abandoned = carts.filter((c) => c.status === 'ABANDONED');
  const atRisk = abandoned.reduce(
    (n, c) => n + c.items.reduce((m, i) => m + (i.product.pricingPlans[0]?.pricePaise ?? 0), 0),
    0,
  );
  const repeat = abandoned.filter((c) => c.visitCount > 1).length;
  const total = abandoned.length + converted;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Abandoned carts"
        description="Learners who reached the payment screen and did not finish. The most qualified list an academy has, and the one nobody keeps."
      />

      <StatGrid>
        <Stat
          label="Waiting"
          value={abandoned.length}
          sub={`quiet for over ${ABANDON_AFTER_HOURS} hours`}
        />
        <Stat
          label="Came back"
          value={repeat}
          sub="opened checkout more than once and still did not pay"
        />
        <Stat
          label="On the table"
          value={formatMoney(atRisk, tenant.currency)}
          sub="list price of what they were looking at"
        />
        <Stat
          label="Recovered"
          value={total > 0 ? `${Math.round((converted / total) * 100)}%` : '—'}
          sub={`${converted} of ${total} carts ended in a payment`}
        />
      </StatGrid>

      {carts.length === 0 ? (
        <EmptyState
          title="Nobody is mid-purchase"
          hint="A cart is recorded when a learner opens the payment screen, and lands here if they go quiet."
        />
      ) : (
        <CartTable
          canEdit={canEdit}
          rows={carts.map((c) => ({
            id: c.id,
            status: c.status,
            visitCount: c.visitCount,
            learnerId: c.user?.id ?? null,
            name: c.user?.name ?? 'A guest',
            contact: c.user?.email ?? c.user?.phone ?? '',
            reachable: Boolean(c.user?.email || c.user?.phone),
            courses: c.items.map((i) => i.product.title),
            valuePaise: c.items.reduce(
              (n, i) => n + (i.product.pricingPlans[0]?.pricePaise ?? 0),
              0,
            ),
            currency: tenant.currency,
            quietSince: c.updatedAt.toISOString(),
          }))}
        />
      )}

      <p className="t-small faint">
        <Link href="/admin/payments" className="hover:underline">
          Payments
        </Link>{' '}
        holds the other half of this story: orders that were paid but did not turn into access.
      </p>

      <Definitions
        items={[
          [
            'Waiting',
            `A cart nobody has touched for over ${ABANDON_AFTER_HOURS} hours. Opening the payment screen again moves it back to live and adds to the visit count.`,
          ],
          ['On the table', 'The list price of the courses in those carts, before any discount or tax. Not revenue, and not a forecast.'],
          ['Recovered', 'Carts that ended in a payment, over every cart that either ended in a payment or is still waiting.'],
          ['Nudge', 'Writes a queued message per learner. Nothing is sent until a messaging provider is connected, and a second press sends nothing twice.'],
        ]}
      />
    </div>
  );
}
