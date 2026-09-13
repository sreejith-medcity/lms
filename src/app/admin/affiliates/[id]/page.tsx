import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/clock';
import { organizationOrigin } from '@/lib/org-origin';
import { affiliateLink, canVoid, saleTotals } from '@/lib/affiliates';
import { Badge, Card, Cell, PageHeader, Row, Table } from '@/components/ui';
import { AffiliateForm, PayoutForm, StatusToggle, VoidSaleButton } from '../editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * One partner: their link to copy, what they have sent, what they are
 * owed, and the button that says they have been paid.
 */
export default async function AffiliatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('marketing.campaigns', 'view');
  const canEdit = me.permissions['marketing.campaigns']?.edit ?? false;

  const affiliate = await db.affiliate.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      code: true,
      status: true,
      commissionPercent: true,
      payoutDetails: true,
      notes: true,
      userId: true,
      _count: { select: { clicks: true } },
      sales: {
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, status: true, basePaise: true, commissionPaise: true, createdAt: true, paidAt: true, payoutRef: true, order: { select: { orderNo: true, user: { select: { name: true } } } } },
      },
    },
  });
  if (!affiliate) notFound();

  const partnerAccount = affiliate.userId
    ? await db.user.findFirst({ where: { id: affiliate.userId, organizationId: tenant.organizationId }, select: { email: true } })
    : null;
  const origin = await organizationOrigin(tenant.organizationId);
  const link = affiliateLink(origin, affiliate.code);
  const t = saleTotals(affiliate.sales);
  const distinct = await db.affiliateClick.groupBy({ by: ['visitorHash'], where: { affiliateId: affiliate.id }, _count: { _all: true } });

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title={affiliate.name}
        description={`${affiliate.commissionPercent}% of every paid order after discount. ${affiliate._count.clicks} clicks, ${distinct.length} visitors, ${t.approved + t.paid} paid sales.`}
        action={canEdit ? <StatusToggle id={affiliate.id} status={affiliate.status} /> : undefined}
      />

      <Card>
        <h2 className="t-heading">Their link</h2>
        <p className="t-small muted mt-1">Anyone who arrives through it is remembered for the window set under Settings, Selling; an order in that window is theirs.</p>
        <p className="mt-3 break-all rounded-[var(--radius-sm)] border bg-[var(--surface-2)] px-3 py-2 font-mono text-sm">{link}</p>
        <p className="t-small faint mt-2">
          Add <span className="font-mono">?to=/course/&lt;slug&gt;</span> to land on a course page instead of the home page.
          {partnerAccount?.email ? ` They see their own numbers when signed in as ${partnerAccount.email}, under Account.` : ''}
        </p>
      </Card>

      {canEdit && t.owedPaise > 0 && (
        <Card>
          <h2 className="t-heading">Pay them</h2>
          <div className="mt-3">
            <PayoutForm affiliateId={affiliate.id} owedLabel={formatMoney(t.owedPaise, tenant.currency)} />
          </div>
          {affiliate.payoutDetails && <p className="t-small faint mt-2">How: {affiliate.payoutDetails}</p>}
        </Card>
      )}

      <Card padded={false}>
        <div className="p-5">
          <h2 className="t-heading">Sales</h2>
          <p className="t-small muted mt-1">
            {formatMoney(t.owedPaise, tenant.currency)} owed · {formatMoney(t.paidPaise, tenant.currency)} paid out · {t.pending} awaiting payment by the buyer · {t.void} void
          </p>
        </div>
        {affiliate.sales.length === 0 ? (
          <p className="t-small faint px-5 pb-5">No sales through this link yet.</p>
        ) : (
          <Table head={['When', 'Order', 'Buyer', 'Base', 'Commission', 'Status', '']}>
            {affiliate.sales.map((s) => (
              <Row key={s.id}>
                <Cell className="t-small whitespace-nowrap">{formatDateTime(s.createdAt, tenant.timezone)}</Cell>
                <Cell className="font-mono text-sm">{s.order.orderNo}</Cell>
                <Cell className="t-small">{s.order.user.name}</Cell>
                <Cell className="tabular-nums">{formatMoney(s.basePaise, tenant.currency)}</Cell>
                <Cell className="tabular-nums">{formatMoney(s.commissionPaise, tenant.currency)}</Cell>
                <Cell>
                  <Badge tone={s.status === 'PAID' ? 'ok' : s.status === 'APPROVED' ? 'warn' : s.status === 'VOID' ? 'bad' : 'neutral'}>
                    {s.status === 'PENDING' ? 'awaiting payment' : s.status === 'APPROVED' ? 'owed' : s.status.toLowerCase()}
                  </Badge>
                  {s.payoutRef && <span className="t-micro faint block">{s.payoutRef}</span>}
                </Cell>
                <Cell className="text-right">{canEdit && canVoid(s.status) && <VoidSaleButton saleId={s.id} />}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {canEdit && (
        <AffiliateForm
          draft={{
            id: affiliate.id,
            name: affiliate.name,
            email: affiliate.email ?? '',
            phone: affiliate.phone ?? '',
            code: affiliate.code,
            commissionPercent: affiliate.commissionPercent,
            payoutDetails: affiliate.payoutDetails ?? '',
            notes: affiliate.notes ?? '',
            userEmail: partnerAccount?.email ?? '',
          }}
        />
      )}
      <p className="t-small">
        <Link href="/admin/affiliates" className="underline">
          All partners
        </Link>
      </p>
    </div>
  );
}
