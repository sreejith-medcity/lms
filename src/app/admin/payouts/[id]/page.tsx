import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/clock';
import { PAYOUT_STATUS_LABEL, hoursLabel, monthWindow, type PayoutLine } from '@/lib/payouts';
import { dayKey } from '@/lib/clock';
import { Badge, Card, Cell, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { AdjustmentForm, MarkPaidForm, PayoutActions } from '../editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const TONE = { DRAFT: 'neutral', APPROVED: 'brand', PAID: 'ok' } as const;

/** One payout: every class it counts, the adjustment, and the close-out. */
export default async function PayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('instructor.instructor_management', 'view');
  const canEdit = me.permissions['instructor.instructor_management']?.edit ?? false;
  const canDelete = me.permissions['instructor.instructor_management']?.delete ?? false;

  const p = await db.instructorPayout.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      id: true, periodFrom: true, sessions: true, minutes: true, ratePaise: true, rateBasis: true, earnedPaise: true, adjustmentPaise: true, adjustmentNote: true, totalPaise: true, lines: true, status: true, approvedAt: true, paidAt: true, paidReference: true, createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!p) notFound();
  const lines = (Array.isArray(p.lines) ? p.lines : []) as unknown as PayoutLine[];
  const monthKey = dayKey(new Date(p.periodFrom.getTime() + 36e5 * 36), tenant.timezone).slice(0, 7);
  const label = monthWindow(monthKey, tenant.timezone)?.label ?? monthKey;
  const dateLabel = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tenant.timezone });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${p.user.name}, ${label}`}
        description={`${p.sessions} classes, ${hoursLabel(p.minutes)}, at ${p.ratePaise > 0 ? `${formatMoney(p.ratePaise, tenant.currency)} per ${p.rateBasis === 'SESSION' ? 'class' : 'hour'}` : 'no rate'}.`}
        action={
          <Link href={`/admin/payouts?month=${monthKey}`} className="t-small underline">
            All payouts for {label}
          </Link>
        }
      />

      <StatGrid>
        <Stat label="Earned from classes" value={formatMoney(p.earnedPaise, tenant.currency)} />
        <Stat label="Adjustment" value={p.adjustmentPaise === 0 ? '—' : formatMoney(p.adjustmentPaise, tenant.currency)} sub={p.adjustmentNote ?? undefined} />
        <Stat label="Total" value={formatMoney(p.totalPaise, tenant.currency)} />
        <Stat label="Status" value={PAYOUT_STATUS_LABEL[p.status] ?? p.status} sub={p.paidAt ? `paid ${dateLabel(p.paidAt)}${p.paidReference ? `, ${p.paidReference}` : ''}` : p.approvedAt ? `approved ${dateLabel(p.approvedAt)}` : `drawn up ${dateLabel(p.createdAt)}`} />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <h2 className="t-heading">Classes counted</h2>
          {lines.length === 0 ? (
            <p className="t-small faint mt-2">None.</p>
          ) : (
            <div className="mt-3">
              <Table head={['Class', 'When', 'Minutes']}>
                {lines.map((l) => (
                  <Row key={l.sessionId}>
                    <Cell>
                      <span className="text-sm">{l.title}</span>
                      <span className="t-small faint block">{l.oneToOne ? 'One-to-one' : l.batch ?? ''}</span>
                    </Cell>
                    <Cell className="tabular-nums">{formatDateTime(new Date(l.startsAt), tenant.timezone)}</Cell>
                    <Cell className="tabular-nums">{l.minutes}</Cell>
                  </Row>
                ))}
              </Table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between gap-2">
              <h2 className="t-heading">Adjustment</h2>
              <Badge tone={TONE[p.status as keyof typeof TONE] ?? 'neutral'}>{PAYOUT_STATUS_LABEL[p.status] ?? p.status}</Badge>
            </div>
            <div className="mt-3">
              <AdjustmentForm id={p.id} adjustmentRupees={p.adjustmentPaise / 100} note={p.adjustmentNote ?? ''} locked={!canEdit || p.status === 'PAID'} />
            </div>
          </Card>

          {canEdit && p.status !== 'PAID' && (
            <Card>
              <h2 className="t-heading">{p.status === 'DRAFT' ? 'Approve' : 'Pay'}</h2>
              <p className="t-small muted mt-1">
                {p.status === 'DRAFT' ? 'Approving freezes the figures. Redrawing the month leaves approved payouts alone.' : 'Once marked paid nothing on it changes again.'}
              </p>
              <div className="mt-3">
                {p.status === 'DRAFT' ? <PayoutActions id={p.id} status={p.status} canDelete={canDelete} /> : <MarkPaidForm id={p.id} />}
              </div>
              {p.status === 'APPROVED' && (
                <div className="mt-3">
                  <PayoutActions id={p.id} status={p.status} canDelete={false} />
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
