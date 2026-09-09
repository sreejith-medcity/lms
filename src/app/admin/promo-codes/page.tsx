import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { describeDiscount } from '@/lib/promo';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { PromoForm, PromoState } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Promo codes, and what they actually cost.
 *
 * The list leads with money given away rather than codes created, because that
 * is the number a discount programme is judged on and the one nobody puts on
 * the screen.
 */
export default async function PromoCodesPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('promocode.view_redemptions', 'view');
  const canEdit = me.permissions['promocode.manage_promocodes']?.edit ?? false;
  const tz = tenant.timezone;

  const [codes, products] = await Promise.all([
    db.promoCode.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        description: true,
        discountType: true,
        discountValue: true,
        maxDiscountPaise: true,
        minOrderPaise: true,
        usageType: true,
        maxRedemptions: true,
        perUserLimit: true,
        startsAt: true,
        endsAt: true,
        isActive: true,
        products: { select: { product: { select: { id: true, title: true } } } },
        redemptions: { select: { amountPaise: true, redeemedAt: true, orderId: true } },
      },
    }),
    db.product.findMany({
      where: { organizationId: tenant.organizationId, deletedAt: null },
      orderBy: { title: 'asc' },
      select: { id: true, title: true },
    }),
  ]);

  const now = new Date();
  const allRedemptions = codes.flatMap((c) => c.redemptions);
  const givenAway = allRedemptions.reduce((n, r) => n + r.amountPaise, 0);
  const live = codes.filter(
    (c) => c.isActive && (!c.startsAt || c.startsAt <= now) && (!c.endsAt || c.endsAt >= now),
  ).length;

  const month = new Date(now.getTime() - 30 * 86_400_000);
  const recent = allRedemptions.filter((r) => r.redeemedAt >= month);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Promo codes"
        description="Discounts with limits that actually hold: a code stamped first fifty lets in fifty."
      />

      <StatGrid>
        <Stat label="Live now" value={live} sub={`${codes.length} in total`} />
        <Stat label="Claimed" value={allRedemptions.length} sub="all time" />
        <Stat
          label="Given away"
          value={formatMoney(givenAway, tenant.currency)}
          sub="total discount across every claim"
        />
        <Stat
          label="Last 30 days"
          value={formatMoney(
            recent.reduce((n, r) => n + r.amountPaise, 0),
            tenant.currency,
          )}
          sub={`${recent.length} ${recent.length === 1 ? 'claim' : 'claims'}`}
        />
      </StatGrid>

      {codes.length === 0 ? (
        <EmptyState title="No codes yet" hint="Write one below and it works at checkout straight away." />
      ) : (
        <Table head={['Code', 'Worth', 'Good for', 'Window', 'Claimed', 'State', '']}>
          {codes.map((c) => {
            const claimed = c.redemptions.length;
            const expired = Boolean(c.endsAt && c.endsAt < now);
            const pending = Boolean(c.startsAt && c.startsAt > now);
            const full = c.maxRedemptions != null && claimed >= c.maxRedemptions;

            return (
              <Row key={c.id}>
                <Cell>
                  <span className="font-mono text-sm font-semibold">{c.code}</span>
                  {c.description && <p className="t-micro faint">{c.description}</p>}
                </Cell>
                <Cell>
                  <span className="text-sm">{describeDiscount(c, tenant.currency)}</span>
                  {c.minOrderPaise ? (
                    <p className="t-micro faint">
                      on orders over {formatMoney(c.minOrderPaise, tenant.currency)}
                    </p>
                  ) : null}
                </Cell>
                <Cell className="muted">
                  {c.products.length === 0
                    ? 'Everything'
                    : c.products.length === 1
                      ? c.products[0].product.title
                      : `${c.products.length} courses`}
                </Cell>
                <Cell className="t-small">
                  {c.startsAt || c.endsAt ? (
                    <>
                      {c.startsAt ? formatDayLabel(dayKey(c.startsAt, tz), tz) : 'now'}
                      {' to '}
                      {c.endsAt ? formatDayLabel(dayKey(c.endsAt, tz), tz) : 'no end'}
                    </>
                  ) : (
                    <span className="faint">Always</span>
                  )}
                </Cell>
                <Cell className="tabular-nums">
                  {claimed}
                  {c.maxRedemptions != null ? ` of ${c.maxRedemptions}` : ''}
                  <p className="t-micro faint">
                    {formatMoney(
                      c.redemptions.reduce((n, r) => n + r.amountPaise, 0),
                      tenant.currency,
                    )}{' '}
                    given
                  </p>
                </Cell>
                <Cell>
                  {expired ? (
                    <Badge tone="neutral">expired</Badge>
                  ) : pending ? (
                    <Badge tone="warn">not live yet</Badge>
                  ) : full ? (
                    <Badge tone="warn">fully claimed</Badge>
                  ) : canEdit ? (
                    <PromoState id={c.id} isActive={c.isActive} used={claimed > 0} />
                  ) : (
                    <Badge tone={c.isActive ? 'ok' : 'neutral'}>{c.isActive ? 'on' : 'off'}</Badge>
                  )}
                </Cell>
                <Cell className="t-small faint text-right">
                  {c.usageType === 'SINGLE'
                    ? 'one claim only'
                    : `${c.perUserLimit} per person`}
                </Cell>
              </Row>
            );
          })}
        </Table>
      )}

      {canEdit && (
        <Card>
          <h2 className="t-heading">Write a code</h2>
          <p className="t-small muted mt-1 max-w-prose">
            Leave the course list empty and the code works on everything. A capped percentage is
            usually what you want: twenty percent off with a ceiling costs a known amount even on
            the priciest course.
          </p>
          <div className="mt-4">
            <PromoForm products={products} currency={tenant.currency} />
          </div>
        </Card>
      )}
    </div>
  );
}
