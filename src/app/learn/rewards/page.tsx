import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { achievementsFor, stampCardsFor, vouchersFor } from '@/lib/rewards';
import { ruleLabel } from '@/lib/reward-rules';
import { Badge, Card, EmptyState } from '@/components/ui';
import { ClaimForm } from './claim-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rewards' };

const EARN_WORDS: Record<string, string> = { CLASS_ATTENDED: 'a stamp for every class you attend', LESSON_FINISHED: 'a stamp for every lesson you finish', PURCHASE: 'a stamp for every course you buy' };

/**
 * The learner's rewards: stamp cards filling up, achievements named by the
 * academy, and vouchers to spend at checkout. A printed voucher is claimed
 * here, by typing its code or by opening the link on its QR.
 */
export default async function RewardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const sp = await searchParams;
  const prefill = (Array.isArray(sp.code) ? sp.code[0] : sp.code) ?? '';
  const [cards, achievements, vouchers] = await Promise.all([stampCardsFor(tenant.organizationId, user.id), achievementsFor(tenant.organizationId, user.id), vouchersFor(tenant.organizationId, user.id)]);
  const live = vouchers.filter((v) => v.status === 'ISSUED');
  const spent = vouchers.filter((v) => v.status !== 'ISSUED');
  const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const nothing = cards.length === 0 && achievements.length === 0 && vouchers.length === 0 && !prefill;

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <h1 className="text-xl font-semibold">Rewards</h1>
      <p className="t-small faint mt-1">Stamp cards, achievements and vouchers from {tenant.name}. A voucher is typed in the code box at checkout.</p>

      {nothing ? (
        <div className="mt-6">
          <EmptyState title="Nothing here yet" hint="When the academy runs a stamp card or names an achievement, your progress shows here. A voucher somebody hands you is claimed below." />
        </div>
      ) : null}

      {cards.length > 0 && (
        <section className="mt-6 space-y-3">
          <h2 className="font-semibold">Stamp cards</h2>
          {cards.map((c) => (
            <Card key={c.schemeId}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{c.name}</p>
                <p className="t-small faint">
                  {c.stamps} of {c.stampsNeeded}
                  {c.cardsFilled > 0 ? ` · ${c.cardsFilled} ${c.cardsFilled === 1 ? 'card' : 'cards'} filled` : ''}
                </p>
              </div>
              <p className="t-small faint mt-0.5">
                {EARN_WORDS[c.earn]}
                {c.product ? ` on ${c.product}` : ''}. A full card earns {c.reward}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2" aria-label={`${c.stamps} of ${c.stampsNeeded} stamps`}>
                {Array.from({ length: c.stampsNeeded }, (_, i) => (
                  <span key={i} aria-hidden className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm ${i < c.stamps ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-dashed text-transparent'}`}>
                    ✓
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </section>
      )}

      {achievements.length > 0 && (
        <section className="mt-6 space-y-3">
          <h2 className="font-semibold">Achievements</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {achievements.map((a) => {
              const earned = a.awards.length > 0;
              return (
                <Card key={a.id}>
                  <div className="flex items-start justify-between gap-2">
                    <p className={`font-medium ${earned ? '' : 'faint'}`}>{a.name}</p>
                    {earned ? <Badge tone="ok">earned{a.awards.length > 1 ? ` ×${a.awards.length}` : ''}</Badge> : <Badge tone="neutral">not yet</Badge>}
                  </div>
                  <p className="t-small faint mt-0.5">
                    {a.description || ruleLabel(a.rule)}
                    {a.product ? ` on ${a.product}` : ''}. Earns {a.reward}.
                  </p>
                  {earned && (
                    <p className="t-small mt-2">
                      {a.awards[0].context ? `${a.awards[0].context}, ` : ''}
                      {day(a.awards[0].awardedAt)}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-6 space-y-3">
        <h2 className="font-semibold">Vouchers</h2>
        {live.length === 0 ? (
          <p className="t-small faint">No voucher to spend right now.</p>
        ) : (
          live.map((v) => (
            <Card key={v.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-mono text-lg font-semibold tracking-wide">{v.code}</p>
                <Badge tone="ok">{v.worth}</Badge>
              </div>
              <p className="t-small faint mt-0.5">
                {v.product ? `On ${v.product}. ` : 'On any course. '}
                {v.expiresAt ? `Use it by ${day(v.expiresAt)}.` : 'No expiry.'} Type the code in the code box at checkout.
              </p>
            </Card>
          ))
        )}
        <Card>
          <p className="font-medium">Have a printed voucher?</p>
          <p className="t-small faint mt-0.5 mb-3">Type its code, or open the link on its QR. Once claimed it is yours and nobody else can use it.</p>
          <ClaimForm prefill={prefill} />
        </Card>
        {spent.length > 0 && (
          <details>
            <summary className="t-small cursor-pointer faint">Spent and expired ({spent.length})</summary>
            <ul className="mt-2 space-y-1">
              {spent.map((v) => (
                <li key={v.id} className="t-small faint">
                  <span className="font-mono">{v.code}</span>, {v.worth}: {v.status === 'REDEEMED' ? `spent${v.redeemedAt ? ` on ${day(v.redeemedAt)}` : ''}` : v.status.toLowerCase()}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
