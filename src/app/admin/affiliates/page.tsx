import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { saleTotals } from '@/lib/affiliates';
import { Badge, Cell, EmptyState, LinkButton, PageHeader, Row, Table } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Partners who send buyers, and what each is owed. The owed column is the
 * point of the page: it is the number the office pays out from.
 */
export default async function AffiliatesPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('marketing.campaigns', 'view');
  const canEdit = me.permissions['marketing.campaigns']?.edit ?? false;

  const affiliates = await db.affiliate.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      commissionPercent: true,
      _count: { select: { clicks: true } },
      sales: { select: { status: true, commissionPaise: true } },
    },
  });

  const owedAll = affiliates.reduce((n, a) => n + saleTotals(a.sales).owedPaise, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Affiliates"
        description={`Partners with a link. A sale through it earns them a share of the order after discount, once it is paid. ${owedAll > 0 ? `${formatMoney(owedAll, tenant.currency)} owed across everyone.` : 'Nothing owed right now.'}`}
        action={canEdit ? <LinkButton href="/admin/affiliates/new">New partner</LinkButton> : undefined}
      />
      <p className="t-small faint">
        The commission report, by month, is under Reports, Marketing.
      </p>

      {affiliates.length === 0 ? (
        <EmptyState
          title="No partners yet"
          hint="A consultant, an agent, a former learner with a following: give them a link and a share."
          action={canEdit ? <LinkButton href="/admin/affiliates/new" size="sm">New partner</LinkButton> : undefined}
        />
      ) : (
        <Table head={['Partner', 'Code', 'Share', 'Clicks', 'Sales', 'Owed', 'Paid out', 'Status']}>
          {affiliates.map((a) => {
            const t = saleTotals(a.sales);
            return (
              <Row key={a.id}>
                <Cell>
                  <Link href={`/admin/affiliates/${a.id}`} className="font-medium underline-offset-2 hover:underline">
                    {a.name}
                  </Link>
                </Cell>
                <Cell className="font-mono text-sm">{a.code}</Cell>
                <Cell className="tabular-nums">{a.commissionPercent}%</Cell>
                <Cell className="tabular-nums">{a._count.clicks}</Cell>
                <Cell className="tabular-nums">
                  {t.approved + t.paid}
                  {t.pending > 0 && <span className="faint"> (+{t.pending} unpaid)</span>}
                </Cell>
                <Cell className="tabular-nums">
                  <span style={t.owedPaise > 0 ? { color: 'var(--warn)', fontWeight: 600 } : undefined}>{formatMoney(t.owedPaise, tenant.currency)}</span>
                </Cell>
                <Cell className="tabular-nums">{formatMoney(t.paidPaise, tenant.currency)}</Cell>
                <Cell>
                  <Badge tone={a.status === 'ACTIVE' ? 'ok' : 'neutral'}>{a.status.toLowerCase()}</Badge>
                </Cell>
              </Row>
            );
          })}
        </Table>
      )}
    </div>
  );
}
