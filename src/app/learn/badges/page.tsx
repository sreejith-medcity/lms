import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { settingBool } from '@/lib/settings/store';
import { addDays, dayKey } from '@/lib/clock';
import { atRisk, currentStreak, standings, streakLine, tierName } from '@/lib/badges';
import { learnerStats, streakFor } from '@/lib/badges-data';
import { Card, EmptyState, ProgressBar } from '@/components/ui';
import { getTranslator } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Badges' };

/**
 * Streak first, because it is the one that changes today; then every
 * badge with the number that earns the next tier, so nothing here is a
 * surprise and nothing is a mystery.
 */
export default async function BadgesPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const t = await getTranslator();
  const on = await settingBool(tenant.organizationId, 'learning.badges');
  if (!on) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-7">
        <EmptyState title="Badges are switched off" hint="The academy has not switched badges on." />
      </div>
    );
  }

  const now = new Date();
  const today = dayKey(now, tenant.timezone);
  const [stats, streak, held] = await Promise.all([
    learnerStats(tenant.organizationId, user.id, tenant.timezone, now),
    streakFor(tenant.organizationId, user.id),
    db.badgeAward.findMany({ where: { organizationId: tenant.organizationId, userId: user.id }, select: { badgeKey: true, tier: true, awardedAt: true } }),
  ]);
  await db.badgeAward.updateMany({ where: { organizationId: tenant.organizationId, userId: user.id, seenAt: null }, data: { seenAt: now } });

  const rows = standings(stats, held);
  const earned = rows.filter((r) => r.tier > 0);
  const current = currentStreak(streak, today);
  const active = new Set(streak.recentDays);
  const weeks = 5;
  const days: string[] = [];
  for (let i = weeks * 7 - 1; i >= 0; i -= 1) days.push(addDays(today, -i));

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <h1 className="text-xl font-semibold">{t('Badges')}</h1>
      <p className="t-small faint mt-1">
        {earned.length === 0 ? 'Nothing earned yet. Every badge below says exactly what earns it.' : `${earned.length} of ${rows.length} badges earned.`}
      </p>

      <div className="mt-6 space-y-5">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="t-eyebrow faint">Streak</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {current > 0 ? '🔥 ' : ''}{current} {current === 1 ? 'day' : 'days'}
              </p>
              <p className={`t-small mt-1 ${atRisk(streak, today) ? 'text-[var(--warn)]' : 'muted'}`}>{streakLine(streak, today)}</p>
            </div>
            <div className="text-right">
              <p className="t-micro faint">Longest</p>
              <p className="text-lg font-semibold tabular-nums">{streak.longest} {streak.longest === 1 ? 'day' : 'days'}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1" aria-label="The last five weeks">
            {days.map((d) => (
              <span
                key={d}
                title={d}
                className={`h-6 rounded-[4px] ${active.has(d) ? 'bg-[var(--brand)]' : 'bg-[var(--surface-2)]'} ${d === today ? 'ring-2 ring-[var(--brand)] ring-offset-1' : ''}`}
              />
            ))}
          </div>
          <p className="t-micro faint mt-2">A day counts when you finish a lesson, attend a class or hand something in, on the academy's clock.</p>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.def.key} className={r.tier === 0 ? 'opacity-90' : ''}>
              <div className="flex items-start gap-3">
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-2xl ${r.tier > 0 ? 'bg-[var(--brand-soft)]' : 'bg-[var(--surface-2)] grayscale'}`} aria-hidden>
                  {r.def.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{r.def.name}</p>
                    {r.tier > 0 && <span className="t-micro rounded-full border px-2 py-0.5">{tierName(r.tier)}</span>}
                  </div>
                  <p className="t-small muted">{r.def.how}</p>
                  <div className="mt-2">
                    <ProgressBar value={r.percent} />
                  </div>
                  <p className="t-micro faint mt-1 tabular-nums">
                    {r.next === null
                      ? `Every tier earned: ${r.value} ${r.def.unit}.`
                      : `${Math.min(r.value, r.next)} of ${r.next} ${r.def.unit}${r.tier > 0 ? ` for ${tierName(r.tier + 1)}` : ''}.`}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
