import { db } from '@/lib/db';
import { loadSettings } from '@/lib/settings/store';
import { Card } from '@/components/ui';

/**
 * A short ranking, off by default.
 *
 * Leaderboards motivate the top of a cohort and discourage everybody else, so
 * this shows the top few plus the viewer's own place rather than a full list:
 * somebody at 40th learns nothing from reading 39 names above them, but does
 * learn something from seeing they are 40th and moving.
 *
 * Names are shortened unless the academy asks otherwise, since a full class
 * list ranked by progress is a thing a learner did not agree to be published in.
 */
export async function Leaderboard({
  organizationId,
  userId,
  batchIds,
  productIds,
}: {
  organizationId: string;
  userId: string;
  batchIds: string[];
  productIds: string[];
}) {
  const settings = await loadSettings(organizationId);
  if (!settings['learning.showLeaderboard']) return null;

  const scope = String(settings['learning.leaderboardScope']);
  const realNames = Boolean(settings['learning.showOthersNames']);

  const where =
    scope === 'BATCH'
      ? { batchId: { in: batchIds } }
      : scope === 'COURSE'
        ? { productId: { in: productIds } }
        : { organizationId };

  if (scope !== 'ACADEMY' && batchIds.length === 0 && productIds.length === 0) return null;

  const rows = await db.enrollment.findMany({
    where: {
      organizationId,
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      ...where,
    },
    orderBy: [{ progressPercent: 'desc' }, { lastActivityAt: 'desc' }],
    take: 200,
    select: {
      userId: true,
      progressPercent: true,
      user: { select: { name: true } },
    },
  });
  if (rows.length < 3) return null;

  // One line per person, best enrolment counted, so somebody on three courses
  // does not appear three times.
  const best = new Map<string, { name: string; percent: number }>();
  for (const row of rows) {
    const current = best.get(row.userId);
    if (!current || row.progressPercent > current.percent) {
      best.set(row.userId, { name: row.user.name, percent: row.progressPercent });
    }
  }

  const ranked = [...best.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.percent - a.percent);

  const myIndex = ranked.findIndex((r) => r.id === userId);
  const top = ranked.slice(0, 5);
  const me = myIndex >= 0 ? { ...ranked[myIndex], rank: myIndex + 1 } : null;
  const inTop = myIndex >= 0 && myIndex < 5;

  const display = (name: string, id: string) =>
    id === userId
      ? 'You'
      : realNames
        ? name
        : `${name.split(' ')[0]} ${name.split(' ')[1]?.[0] ?? ''}`.trim();

  return (
    <Card padded={false}>
      <div className="flex items-baseline justify-between gap-3 border-b px-5 py-3">
        <h2 className="t-heading">Furthest along</h2>
        <span className="t-micro faint">
          {scope === 'BATCH' ? 'your batch' : scope === 'COURSE' ? 'your courses' : 'the academy'}
        </span>
      </div>

      <ol className="divide-y">
        {top.map((row, i) => (
          <li
            key={row.id}
            className={`flex items-center gap-3 px-5 py-2.5 ${row.id === userId ? 'bg-[var(--brand-soft)]' : ''}`}
          >
            <span className="t-small faint w-6 shrink-0 tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{display(row.name, row.id)}</span>
            <span className="t-small shrink-0 tabular-nums">{Math.round(row.percent)}%</span>
          </li>
        ))}

        {me && !inTop && (
          <li className="flex items-center gap-3 bg-[var(--brand-soft)] px-5 py-2.5">
            <span className="t-small faint w-6 shrink-0 tabular-nums">{me.rank}</span>
            <span className="min-w-0 flex-1 truncate text-sm">You</span>
            <span className="t-small shrink-0 tabular-nums">{Math.round(me.percent)}%</span>
          </li>
        )}
      </ol>
    </Card>
  );
}
