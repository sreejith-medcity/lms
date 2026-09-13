import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { bundleSaving } from '@/lib/learning-paths';
import { Badge, Cell, EmptyState, LinkButton, PageHeader, Row, Table } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Bundles: several courses at one price. The saving column is what sells
 * them, so it is computed here from the real plans rather than trusted from
 * a field somebody typed.
 */
export default async function BundlesPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('courses.course_management', 'view');
  const canEdit = me.permissions['courses.course_management']?.edit ?? false;

  const planSelect = {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    take: 1,
    select: { pricePaise: true, currency: true },
  } as const;

  const bundles = await db.product.findMany({
    where: { organizationId: tenant.organizationId, type: 'BUNDLE', deletedAt: null },
    orderBy: [{ status: 'asc' }, { title: 'asc' }],
    select: {
      id: true,
      title: true,
      status: true,
      isFeatured: true,
      pricingPlans: planSelect,
      _count: { select: { orderItems: true } },
      bundle: {
        select: {
          items: {
            orderBy: { sortOrder: 'asc' },
            select: { product: { select: { title: true, pricingPlans: planSelect } } },
          },
        },
      },
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bundles"
        description="Several courses sold as one product at one price. Buying one enrols the learner in every course inside."
        action={canEdit ? <LinkButton href="/admin/bundles/new">New bundle</LinkButton> : undefined}
      />

      {bundles.length === 0 ? (
        <EmptyState
          title="No bundles yet"
          hint="Pair the courses learners take one after another, A1 with A2 say, and price the pair below what they cost apart."
          action={canEdit ? <LinkButton href="/admin/bundles/new" size="sm">New bundle</LinkButton> : undefined}
        />
      ) : (
        <Table head={['Bundle', 'Courses', 'Price', 'Saving', 'Sold', 'Status']}>
          {bundles.map((b) => {
            const plan = b.pricingPlans[0];
            const parts = (b.bundle?.items ?? []).map((i) => i.product.pricingPlans[0]?.pricePaise ?? 0);
            const saving = plan ? bundleSaving(plan.pricePaise, parts) : null;
            return (
              <Row key={b.id}>
                <Cell>
                  <Link href={`/admin/bundles/${b.id}`} className="font-medium underline-offset-2 hover:underline">
                    {b.title}
                  </Link>
                  {b.isFeatured && (
                    <span className="ml-2">
                      <Badge tone="brand">featured</Badge>
                    </span>
                  )}
                </Cell>
                <Cell className="t-small muted">
                  {(b.bundle?.items ?? []).map((i) => i.product.title).join(' + ') || 'None'}
                </Cell>
                <Cell className="whitespace-nowrap">{plan ? formatMoney(plan.pricePaise, plan.currency) : <span className="faint">No price yet</span>}</Cell>
                <Cell className="whitespace-nowrap">
                  {saving && saving.savingPaise > 0 ? (
                    <span style={{ color: 'var(--ok)' }}>
                      {formatMoney(saving.savingPaise, plan?.currency ?? tenant.currency)} ({saving.savingPercent}%)
                    </span>
                  ) : (
                    <span className="faint">–</span>
                  )}
                </Cell>
                <Cell className="tabular-nums">{b._count.orderItems}</Cell>
                <Cell>
                  <Badge tone={b.status === 'PUBLISHED' ? 'ok' : b.status === 'DRAFT' ? 'neutral' : 'warn'}>
                    {b.status.toLowerCase()}
                  </Badge>
                </Cell>
              </Row>
            );
          })}
        </Table>
      )}
    </div>
  );
}
