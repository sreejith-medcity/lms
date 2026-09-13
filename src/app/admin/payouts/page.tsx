import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { PAYOUT_STATUS_LABEL, hoursLabel, monthWindow, recentMonthKeys } from '@/lib/payouts';
import { draftPayouts } from '@/lib/teaching-data';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { MonthBar, PayoutActions } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const TONE = { DRAFT: 'neutral', APPROVED: 'brand', PAID: 'ok' } as const;

/**
 * What the trainers are owed for a month.
 *
 * Drawn up from the calendar rather than typed from memory: every completed
 * class names who took it, at the rate on their profile. What the office
 * changes by hand is an adjustment with a reason, and the month closes by
 * approving and then marking paid.
 */
export default async function PayoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const me = await requireStaff('instructor.instructor_management', 'view');
  const canEdit = me.permissions['instructor.instructor_management']?.edit ?? false;
  const canDelete = me.permissions['instructor.instructor_management']?.delete ?? false;
  const sp = await searchParams;
  const now = new Date();
  const keys = recentMonthKeys(now, tenant.timezone, 12);
  const selected = typeof sp.month === 'string' && monthWindow(sp.month, tenant.timezone) ? sp.month : keys[1] ?? keys[0];
  const window = monthWindow(selected, tenant.timezone)!;
  const months = keys.map((k) => ({ key: k, label: monthWindow(k, tenant.timezone)!.label }));

  const [payouts, drafts] = await Promise.all([
    db.instructorPayout.findMany({
      where: { organizationId: tenant.organizationId, periodFrom: window.from },
      orderBy: { user: { name: 'asc' } },
      select: { id: true, userId: true, sessions: true, minutes: true, ratePaise: true, rateBasis: true, earnedPaise: true, adjustmentPaise: true, totalPaise: true, status: true, paidAt: true, user: { select: { name: true } } },
    }),
    draftPayouts(tenant.organizationId, window.from, window.to),
  ]);
  const drawn = new Set(payouts.map((p) => p.userId));
  const notYet = drafts.filter((d) => !drawn.has(d.userId));

  const total = payouts.reduce((n, p) => n + p.totalPaise, 0);
  const paid = payouts.filter((p) => p.status === 'PAID').reduce((n, p) => n + p.totalPaise, 0);
  const minutes = payouts.reduce((n, p) => n + p.minutes, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trainer payouts"
        description="What each trainer is owed for the month, from the classes on the calendar at the rate on their profile. Adjust with a reason, approve, mark paid."
        action={
          <Link href="/admin/instructors" className="t-small underline">
            Rates are on Instructors
          </Link>
        }
      />

      <MonthBar months={months} selected={selected} canEdit={canEdit} />

      <StatGrid>
        <Stat label={`Owed for ${window.label}`} value={formatMoney(total, tenant.currency)} sub={`${payouts.length} trainer${payouts.length === 1 ? '' : 's'} drawn up`} />
        <Stat label="Paid" value={formatMoney(paid, tenant.currency)} sub={`${formatMoney(total - paid, tenant.currency)} still to pay`} />
        <Stat label="Hours taught" value={hoursLabel(minutes)} sub={`${payouts.reduce((n, p) => n + p.sessions, 0)} classes`} />
        <Stat label="Not yet drawn up" value={String(notYet.length)} sub={notYet.length ? 'took classes this month' : 'everyone is in'} />
      </StatGrid>

      {payouts.length === 0 && notYet.length === 0 ? (
        <EmptyState title={`No completed classes in ${window.label}`} hint="Payouts come from classes marked completed on the calendar." />
      ) : (
        <Card padded={false}>
          <Table head={['Trainer', 'Classes', 'Hours', 'Rate', 'Earned', 'Adjustment', 'Total', 'Status', '']}>
            {payouts.map((p) => (
              <Row key={p.id}>
                <Cell>
                  <Link href={`/admin/payouts/${p.id}`} className="font-medium hover:underline">{p.user.name}</Link>
                </Cell>
                <Cell className="tabular-nums">{p.sessions}</Cell>
                <Cell className="tabular-nums">{hoursLabel(p.minutes)}</Cell>
                <Cell className="tabular-nums">{p.ratePaise > 0 ? `${formatMoney(p.ratePaise, tenant.currency)}/${p.rateBasis === 'SESSION' ? 'class' : 'hr'}` : <span className="text-[var(--bad)]">no rate</span>}</Cell>
                <Cell className="tabular-nums">{formatMoney(p.earnedPaise, tenant.currency)}</Cell>
                <Cell className="tabular-nums">{p.adjustmentPaise === 0 ? <span className="faint">—</span> : formatMoney(p.adjustmentPaise, tenant.currency)}</Cell>
                <Cell className="tabular-nums font-medium">{formatMoney(p.totalPaise, tenant.currency)}</Cell>
                <Cell><Badge tone={TONE[p.status as keyof typeof TONE] ?? 'neutral'}>{PAYOUT_STATUS_LABEL[p.status] ?? p.status}</Badge></Cell>
                <Cell>{canEdit && <PayoutActions id={p.id} status={p.status} canDelete={canDelete} />}</Cell>
              </Row>
            ))}
            {notYet.map((d) => (
              <Row key={d.userId}>
                <Cell><span className="font-medium">{d.name}</span><span className="t-small faint block">not drawn up yet</span></Cell>
                <Cell className="tabular-nums">{d.maths.sessions}</Cell>
                <Cell className="tabular-nums">{hoursLabel(d.maths.minutes)}</Cell>
                <Cell className="tabular-nums">{d.hasRate ? `${formatMoney(d.maths.ratePaise, tenant.currency)}/${d.maths.rateBasis === 'SESSION' ? 'class' : 'hr'}` : <span className="text-[var(--bad)]">no rate</span>}</Cell>
                <Cell className="tabular-nums muted">{formatMoney(d.maths.earnedPaise, tenant.currency)}</Cell>
                <Cell><span className="faint">—</span></Cell>
                <Cell className="tabular-nums muted">{formatMoney(d.maths.earnedPaise, tenant.currency)}</Cell>
                <Cell><Badge tone="neutral">preview</Badge></Cell>
                <Cell>{''}</Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      {notYet.some((d) => !d.hasRate) && (
        <p className="t-small muted">
          Trainers marked "no rate" took classes but have no hourly or per-class rate on their profile; their payout draws up at zero until one is set.
        </p>
      )}
    </div>
  );
}
