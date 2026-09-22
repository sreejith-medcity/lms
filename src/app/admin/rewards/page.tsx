import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { currentHost, requireStaff } from '@/lib/auth';
import { learnerWhere, staffScope } from '@/lib/scope';
import { describeVoucher, ruleLabel } from '@/lib/reward-rules';
import { rewardWords } from '@/lib/rewards';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { AchievementForm, AchievementToggle, CancelVoucher, EditableRow, IssueForm, SchemeForm, SchemeToggle, type AchievementRow, type CourseOption, type SchemeRow } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const EARN_WORDS: Record<string, string> = { CLASS_ATTENDED: 'a stamp per class attended', LESSON_FINISHED: 'a stamp per lesson finished', PURCHASE: 'a stamp per course bought' };

/**
 * Rewards: stamp cards, achievements and vouchers. Points and referrals
 * have their own page; this is the rest of the loyalty set, the parts that
 * are legible without arithmetic.
 */
export default async function RewardsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.preferences', 'view');
  const canEdit = me.permissions['settings.preferences']?.edit ?? false;
  const scope = await staffScope(me);

  const [schemes, achievements, courses, vouchers, cardCount, awardCount, printed, unclaimed] = await Promise.all([
    db.stampScheme.findMany({ where: { organizationId: tenant.organizationId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: { _count: { select: { cards: true } } } }),
    db.achievement.findMany({ where: { organizationId: tenant.organizationId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: { _count: { select: { awards: true } } } }),
    db.product.findMany({ where: { organizationId: tenant.organizationId, type: 'COURSE', deletedAt: null }, orderBy: { title: 'asc' }, select: { id: true, title: true } }),
    db.voucher.findMany({
      where: { organizationId: tenant.organizationId, OR: [{ userId: null }, { user: learnerWhere(scope) }] },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, code: true, kind: true, value: true, maxDiscountPaise: true, status: true, expiresAt: true, redeemedAt: true, source: true, batchLabel: true, productId: true, user: { select: { id: true, name: true } } },
    }),
    db.stampCard.count({ where: { organizationId: tenant.organizationId, cardsFilled: { gt: 0 } } }),
    db.achievementAward.count({ where: { achievement: { organizationId: tenant.organizationId } } }),
    db.voucher.groupBy({ by: ['batchLabel'], where: { organizationId: tenant.organizationId, source: 'BATCH', batchLabel: { not: null } }, _count: { _all: true }, _max: { createdAt: true } }),
    db.voucher.groupBy({ by: ['batchLabel'], where: { organizationId: tenant.organizationId, source: 'BATCH', batchLabel: { not: null }, status: 'ISSUED', userId: null }, _count: { _all: true } }),
  ]);
  const batches = printed
    .map((b) => ({ label: b.batchLabel ?? '', total: b._count._all, unclaimed: unclaimed.find((u) => u.batchLabel === b.batchLabel)?._count._all ?? 0, at: b._max.createdAt }))
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    .slice(0, 30);
  const courseOptions: CourseOption[] = courses;
  const titleOf = (id: string | null) => (id ? (courses.find((c) => c.id === id)?.title ?? 'one course') : null);
  const schemeRows: SchemeRow[] = schemes.map((s) => ({
    id: s.id,
    name: s.name,
    stampsNeeded: s.stampsNeeded,
    earn: s.earn,
    productId: s.productId,
    reward: s.reward,
    rewardPoints: s.rewardPoints,
    voucherKind: s.voucherKind,
    voucherValue: s.voucherValue == null ? null : s.voucherKind === 'FLAT' ? Math.round(s.voucherValue / 100) : s.voucherValue,
    voucherDays: s.voucherDays,
    isActive: s.isActive,
  }));
  const achievementRows: AchievementRow[] = achievements.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    rule: a.rule,
    threshold: a.threshold,
    productId: a.productId,
    rewardPoints: a.rewardPoints,
    voucherKind: a.voucherKind,
    voucherValue: a.voucherValue == null ? null : a.voucherKind === 'FLAT' ? Math.round(a.voucherValue / 100) : a.voucherValue,
    voucherDays: a.voucherDays,
    isActive: a.isActive,
  }));
  const now = new Date();
  const live = vouchers.filter((v) => v.status === 'ISSUED' && (!v.expiresAt || v.expiresAt > now));
  const claimBase = `https://${await currentHost()}/learn/rewards`;
  const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-6">
      <PageHeader title="Rewards" description="Stamp cards that fill up, achievements the academy names, and vouchers issued to one person and spent once. Points and referrals are on their own page." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            Stamp cards <Badge tone="brand">{cardCount} filled so far</Badge>
          </p>
          <p className="t-small faint mt-0.5">Attend eight classes, get the ninth free. A stamp per class, lesson or purchase; a full card pays out and a fresh one starts.</p>
          {schemeRows.length === 0 ? (
            <p className="t-small faint mt-3">No card yet.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {schemeRows.map((s, i) => (
                <EditableRow
                  key={s.id}
                  label={
                    <>
                      <p className="font-medium">
                        {s.name} {!s.isActive && <Badge tone="neutral">paused</Badge>}
                      </p>
                      <p className="t-small faint">
                        {s.stampsNeeded} stamps, {EARN_WORDS[s.earn]}
                        {s.productId ? ` of ${titleOf(s.productId)}` : ''}; a full card earns {rewardWords(schemes[i])}. {schemes[i]._count.cards} learners collecting.
                      </p>
                    </>
                  }
                  form={(close) => (canEdit ? <SchemeForm draft={s} courses={courseOptions} onDone={close} /> : <p className="t-small faint">Editing needs the preferences permission.</p>)}
                >
                  {canEdit && <SchemeToggle id={s.id} isActive={s.isActive} />}
                </EditableRow>
              ))}
            </ul>
          )}
          {canEdit && (
            <details className="mt-4">
              <summary className="t-small cursor-pointer font-medium">Add a card</summary>
              <div className="mt-3">
                <SchemeForm draft={null} courses={courseOptions} />
              </div>
            </details>
          )}
        </Card>

        <Card>
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            Achievements <Badge tone="brand">{awardCount} awarded</Badge>
          </p>
          <p className="t-small faint mt-0.5">Finished a module, sat every class in a month, passed at the first attempt. Named by the academy, measured here, awarded once per thing, with points or a voucher attached if you like.</p>
          {achievementRows.length === 0 ? (
            <p className="t-small faint mt-3">None yet. The badge ladder under Points still runs on its own.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {achievementRows.map((a, i) => (
                <EditableRow
                  key={a.id}
                  label={
                    <>
                      <p className="font-medium">
                        {a.name} {!a.isActive && <Badge tone="neutral">paused</Badge>}
                      </p>
                      <p className="t-small faint">
                        {ruleLabel(a.rule)}
                        {a.rule === 'PASSED_FIRST_ATTEMPT' ? ` at ${a.threshold}% or better` : a.rule === 'STREAK_DAYS' ? `, ${a.threshold} days` : a.rule === 'FULL_MONTH_ATTENDANCE' ? `, ${a.threshold} or more classes held` : ''}
                        {a.productId ? ` on ${titleOf(a.productId)}` : ''}; earns {rewardWords({ rewardPoints: a.rewardPoints, voucherKind: a.voucherKind, voucherValue: achievements[i].voucherValue })}. Awarded {achievements[i]._count.awards} times.
                      </p>
                    </>
                  }
                  form={(close) => (canEdit ? <AchievementForm draft={a} courses={courseOptions} onDone={close} /> : <p className="t-small faint">Editing needs the preferences permission.</p>)}
                >
                  {canEdit && <AchievementToggle id={a.id} isActive={a.isActive} />}
                </EditableRow>
              ))}
            </ul>
          )}
          {canEdit && (
            <details className="mt-4">
              <summary className="t-small cursor-pointer font-medium">Add an achievement</summary>
              <div className="mt-3">
                <AchievementForm draft={null} courses={courseOptions} />
              </div>
            </details>
          )}
        </Card>
      </div>

      <Card>
        <p className="font-semibold">Issue a voucher</p>
        <p className="t-small faint mt-0.5">
          To one learner by name, or a printed batch that whoever scans it first keeps. A voucher is typed in the code box at checkout like a promo code, and is spent once. Learners claim a printed one at <span className="font-medium">/learn/rewards</span>.
        </p>
        <div className="mt-4">{canEdit ? <IssueForm courses={courseOptions} claimBase={claimBase} /> : <p className="t-small faint">Issuing needs the preferences permission.</p>}</div>
      </Card>

      {batches.length > 0 && (
        <Card>
          <p className="font-semibold">Printed batches</p>
          <p className="t-small faint mt-0.5">
            Each batch as a sheet of QR labels in the academy's colours, eight to a page, with the code printed beside each for the phone that will not scan. Only the codes nobody has claimed yet are printed, so a batch printed again halfway through hands out nothing that is already somebody's.
          </p>
          <ul className="mt-3 divide-y">
            {batches.map((b) => (
              <li key={b.label} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  {b.label}
                  <span className="t-small faint">
                    {' '}
                    {b.unclaimed} of {b.total} unclaimed{b.at ? `, printed ${day(b.at)}` : ''}
                  </span>
                </span>
                {b.unclaimed > 0 ? (
                  <a href={`/api/qr/vouchers?batch=${encodeURIComponent(b.label)}`} target="_blank" rel="noreferrer" className="t-small underline underline-offset-2">
                    Print QR labels
                  </a>
                ) : (
                  <span className="t-small faint">all claimed</span>
                )}
              </li>
            ))}
          </ul>
          <p className="t-small faint mt-3">
            Posters for a wall or a window (sign up, enquire, a course page) are under <Link href="/admin/storefront" className="underline underline-offset-2">Storefront</Link>.
          </p>
        </Card>
      )}

      <Card>
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          Vouchers <Badge tone="brand">{live.length} live</Badge>
        </p>
        {vouchers.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No voucher yet" hint="Issued ones, printed ones and the ones stamp cards and achievements hand out all show here." />
          </div>
        ) : (
          <div className="mt-3">
            <Table head={['Code', 'Worth', 'Holder', 'From', 'Expires', 'Status', '']}>
              {vouchers.map((v) => {
                const expired = v.status === 'ISSUED' && v.expiresAt && v.expiresAt < now;
                const status = expired ? 'EXPIRED' : v.status;
                return (
                  <Row key={v.id}>
                    <Cell>
                      <span className="font-mono">{v.code}</span>
                    </Cell>
                    <Cell>
                      {describeVoucher(v, tenant.currency)}
                      {v.productId && <span className="t-small faint"> on {titleOf(v.productId)}</span>}
                    </Cell>
                    <Cell>
                      {v.user ? (
                        <Link href={`/admin/learners/${v.user.id}`} className="underline-offset-2 hover:underline">
                          {v.user.name}
                        </Link>
                      ) : (
                        <span className="faint">not claimed yet</span>
                      )}
                    </Cell>
                    <Cell>
                      <span className="t-small">{v.source === 'BATCH' ? (v.batchLabel ?? 'printed') : v.source === 'STAMP_CARD' ? 'stamp card' : v.source === 'ACHIEVEMENT' ? 'achievement' : 'the office'}</span>
                    </Cell>
                    <Cell>{v.expiresAt ? day(v.expiresAt) : <span className="faint">never</span>}</Cell>
                    <Cell>
                      <Badge tone={status === 'ISSUED' ? 'ok' : status === 'REDEEMED' ? 'neutral' : status === 'EXPIRED' ? 'warn' : 'bad'}>{status === 'REDEEMED' && v.redeemedAt ? `spent ${day(v.redeemedAt)}` : status.toLowerCase()}</Badge>
                    </Cell>
                    <Cell>{canEdit && status === 'ISSUED' ? <CancelVoucher id={v.id} /> : null}</Cell>
                  </Row>
                );
              })}
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
