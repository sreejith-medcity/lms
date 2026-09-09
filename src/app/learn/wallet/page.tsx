import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { loyaltyConfig, pointsToPaise, REASON_LABELS } from '@/lib/wallet';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { Card, EmptyState } from '@/components/ui';
import { ReferralPanel } from './referral';

export const dynamic = 'force-dynamic';

/**
 * The learner's own balance.
 *
 * Shown as money first and points second, because "180 points" means nothing
 * and "180 points, worth 180 rupees off" means everything.
 */
export default async function WalletPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const tz = tenant.timezone;

  const config = await loyaltyConfig(tenant.organizationId);

  const wallet = await db.walletAccount.findUnique({
    where: { userId: user.id },
    select: {
      balancePoints: true,
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, points: true, reason: true, note: true, createdAt: true },
      },
    },
  });

  const balance = wallet?.balancePoints ?? 0;
  const referred = await db.referral.count({ where: { referrerId: user.id } });

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <div className="space-y-6">
        <div>
          <Link href="/learn" className="t-small faint hover:underline">
            My learning
          </Link>
          <h1 className="t-title mt-1">Your credit</h1>
        </div>

        {!config.enabled ? (
          <EmptyState
            title="Credit is not switched on"
            hint="Your academy has not turned on points yet."
          />
        ) : (
          <>
            <Card>
              <p className="t-micro faint">Worth</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {formatMoney(pointsToPaise(balance, config), tenant.currency)}
              </p>
              <p className="t-small muted mt-1">
                {balance} points. Up to {config.maxRedeemablePercent}% of any order can be paid with
                them.
              </p>
            </Card>

            <ReferralPanel referred={referred} />

            <section className="space-y-3">
              <h2 className="t-heading">Every change</h2>
              {!wallet || wallet.transactions.length === 0 ? (
                <EmptyState
                  title="Nothing yet"
                  hint="Points appear here the moment anything moves, with the reason."
                />
              ) : (
                <Card padded={false}>
                  <ul className="divide-y">
                    {wallet.transactions.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                        <span className="min-w-0">
                          <span className="block text-sm">
                            {REASON_LABELS[t.reason] ?? t.reason}
                          </span>
                          <span className="t-micro faint">
                            {formatDayLabel(dayKey(t.createdAt, tz), tz)}
                            {t.note ? ` · ${t.note}` : ''}
                          </span>
                        </span>
                        <span
                          className="shrink-0 text-sm font-medium tabular-nums"
                          style={{ color: t.points > 0 ? 'var(--ok)' : 'var(--bad)' }}
                        >
                          {t.points > 0 ? '+' : ''}
                          {t.points}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
