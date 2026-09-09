import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { loyaltyConfig, pointsToPaise, REASON_LABELS } from '@/lib/wallet';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { Definitions } from '@/components/analytics-bits';
import { LoyaltyForm, AdjustForm } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Points, and what they are worth.
 *
 * The figure worth watching is the liability: points already given out are a
 * discount the academy has promised and not yet paid for. It leads the page for
 * that reason.
 */
export default async function LoyaltyPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.preferences', 'view');
  const canEdit = me.permissions['settings.preferences']?.edit ?? false;
  const tz = tenant.timezone;

  const config = await loyaltyConfig(tenant.organizationId);

  const [wallets, ledger, referrals, learners] = await Promise.all([
    db.walletAccount.findMany({
      where: { user: { organizationId: tenant.organizationId, deletedAt: null } },
      orderBy: { balancePoints: 'desc' },
      take: 25,
      select: {
        id: true,
        balancePoints: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    db.walletTransaction.findMany({
      where: { wallet: { user: { organizationId: tenant.organizationId } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        points: true,
        reason: true,
        note: true,
        createdAt: true,
        wallet: { select: { user: { select: { name: true } } } },
      },
    }),
    db.referral.findMany({
      where: { referrer: { organizationId: tenant.organizationId } },
      orderBy: { signedUpAt: 'desc' },
      take: 25,
      select: {
        id: true,
        signedUpAt: true,
        purchasedAt: true,
        referrer: { select: { name: true } },
        referee: { select: { name: true } },
      },
    }),
    db.user.findMany({
      where: { organizationId: tenant.organizationId, kind: 'LEARNER', deletedAt: null },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, email: true },
    }),
  ]);

  const outstanding = await db.walletAccount.aggregate({
    where: { user: { organizationId: tenant.organizationId, deletedAt: null } },
    _sum: { balancePoints: true },
    _count: true,
  });

  const spent = await db.walletTransaction.aggregate({
    where: {
      reason: 'REDEMPTION',
      wallet: { user: { organizationId: tenant.organizationId } },
    },
    _sum: { points: true },
  });

  const balance = outstanding._sum.balancePoints ?? 0;
  const redeemed = Math.abs(spent._sum.points ?? 0);
  const converted = referrals.filter((r) => r.purchasedAt).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Points and referrals"
        description="A discount you have promised and not yet paid for. Worth watching as a number, not a feature."
      />

      <StatGrid>
        <Stat
          label="Outstanding"
          value={formatMoney(pointsToPaise(balance, config), tenant.currency)}
          sub={`${balance} points across ${outstanding._count} wallets`}
        />
        <Stat
          label="Already spent"
          value={formatMoney(pointsToPaise(redeemed, config), tenant.currency)}
          sub={`${redeemed} points redeemed`}
        />
        <Stat
          label="Referrals"
          value={referrals.length}
          sub={`${converted} of them went on to buy`}
        />
        <Stat
          label="Ceiling per order"
          value={config.enabled ? `${config.maxRedeemablePercent}%` : 'off'}
          sub={config.enabled ? 'of the payable total' : 'points are switched off'}
        />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="t-heading">How points work here</h2>
          <div className="mt-4">
            <LoyaltyForm config={config} currency={tenant.currency} canEdit={canEdit} />
          </div>
        </Card>

        <div className="space-y-5">
          {canEdit && (
            <Card>
              <h2 className="t-heading">Adjust a balance</h2>
              <p className="t-small muted mt-1">
                A negative number takes points away. The reason is kept on the learner&apos;s ledger.
              </p>
              <div className="mt-4">
                <AdjustForm learners={learners} />
              </div>
            </Card>
          )}

          <Card padded={false}>
            <h2 className="t-heading border-b px-5 py-3">Biggest balances</h2>
            {wallets.length === 0 ? (
              <p className="t-small faint px-5 py-6">Nobody has any points yet.</p>
            ) : (
              <ul className="divide-y">
                {wallets.slice(0, 8).map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{w.user.name}</span>
                      <span className="t-micro faint truncate">{w.user.email}</span>
                    </span>
                    <span className="t-small shrink-0 tabular-nums">
                      {w.balancePoints} ·{' '}
                      {formatMoney(pointsToPaise(w.balancePoints, config), tenant.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="t-heading">The ledger</h2>
        {ledger.length === 0 ? (
          <EmptyState title="Nothing has moved yet" hint="Every change to a balance appears here with its reason." />
        ) : (
          <Table head={['When', 'Learner', 'Points', 'Why', 'Note']}>
            {ledger.map((t) => (
              <Row key={t.id}>
                <Cell className="t-small faint whitespace-nowrap">
                  {formatDayLabel(dayKey(t.createdAt, tz), tz)}
                </Cell>
                <Cell>{t.wallet.user.name}</Cell>
                <Cell className="tabular-nums font-medium">
                  <span style={{ color: t.points > 0 ? 'var(--ok)' : 'var(--bad)' }}>
                    {t.points > 0 ? '+' : ''}
                    {t.points}
                  </span>
                </Cell>
                <Cell className="muted">{REASON_LABELS[t.reason] ?? t.reason}</Cell>
                <Cell className="t-small faint">{t.note ?? '—'}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </section>

      <Definitions
        items={[
          [
            'Outstanding',
            'Every point currently sitting in a wallet, priced at the conversion below. It is money the academy has promised as a discount and not yet given up.',
          ],
          ['Ceiling per order', 'The most of any one payable total that points may cover, so a course can never be had for nothing.'],
          ['Referrals', 'People who signed up with somebody else’s code, and how many of them went on to pay.'],
        ]}
      />
    </div>
  );
}
