import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { dayKey, formatDayLabel, todayKey } from '@/lib/clock';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { ChequeActions, NewCheque } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The cheque drawer.
 *
 * Sorted by the date on the paper rather than the date it was typed in, because
 * the question this screen answers is which cheques should have cleared by now
 * and have not.
 */
export default async function ChequesPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('sales.cheques', 'view');
  const canEdit = me.permissions['sales.cheques']?.edit ?? false;
  const tz = tenant.timezone;
  const today = todayKey(tz);

  const [cheques, learners] = await Promise.all([
    db.cheque.findMany({
      where: { payment: { organizationId: tenant.organizationId } },
      orderBy: [{ status: 'asc' }, { chequeDate: 'asc' }],
      take: 300,
      select: {
        id: true,
        studentName: true,
        parentName: true,
        bankName: true,
        chequeNo: true,
        chequeDate: true,
        status: true,
        remark: true,
        payment: { select: { amountPaise: true, currency: true, userId: true } },
      },
    }),
    db.user.findMany({
      where: { organizationId: tenant.organizationId, kind: 'LEARNER', deletedAt: null },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, email: true },
    }),
  ]);

  const pending = cheques.filter((c) => c.status === 'PENDING');
  const bounced = cheques.filter((c) => c.status === 'BOUNCED');
  const overdue = pending.filter((c) => dayKey(c.chequeDate, tz) < today);

  const sum = (list: typeof cheques) => list.reduce((n, c) => n + c.payment.amountPaise, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cheques"
        description="Paper that has been handed over and not yet arrived. It counts as collected only once it clears."
      />

      <StatGrid>
        <Stat
          label="In the drawer"
          value={formatMoney(sum(pending), tenant.currency)}
          sub={`${pending.length} uncleared`}
        />
        <Stat
          label="Past their date"
          value={overdue.length}
          sub={overdue.length > 0 ? 'should have cleared by now' : 'none overdue'}
        />
        <Stat
          label="Bounced"
          value={formatMoney(sum(bounced), tenant.currency)}
          sub={`${bounced.length} returned`}
        />
        <Stat
          label="Cleared"
          value={formatMoney(sum(cheques.filter((c) => c.status === 'CLEARED')), tenant.currency)}
          sub="counted in collections"
        />
      </StatGrid>

      {cheques.length === 0 ? (
        <EmptyState title="The drawer is empty" hint="Record a cheque below as it comes in." />
      ) : (
        <Table head={['Cheque', 'From', 'Bank', 'Dated', 'Amount', 'State', '']}>
          {cheques.map((c) => {
            const late = c.status === 'PENDING' && dayKey(c.chequeDate, tz) < today;
            return (
              <Row key={c.id}>
                <Cell>
                  <span className="font-mono text-sm">{c.chequeNo}</span>
                  {c.remark && <p className="t-micro faint">{c.remark}</p>}
                </Cell>
                <Cell>
                  {c.studentName}
                  {c.parentName && <p className="t-micro faint">paid by {c.parentName}</p>}
                </Cell>
                <Cell className="muted">{c.bankName}</Cell>
                <Cell className="whitespace-nowrap">
                  <span className={late ? 'text-[var(--bad)]' : ''}>
                    {formatDayLabel(dayKey(c.chequeDate, tz), tz)}
                  </span>
                  {late && <p className="t-micro text-[var(--bad)]">past its date</p>}
                </Cell>
                <Cell className="tabular-nums">
                  {formatMoney(c.payment.amountPaise, c.payment.currency)}
                </Cell>
                <Cell>
                  <Badge
                    tone={
                      c.status === 'CLEARED' ? 'ok' : c.status === 'BOUNCED' ? 'bad' : 'warn'
                    }
                  >
                    {c.status.toLowerCase()}
                  </Badge>
                </Cell>
                <Cell className="text-right">
                  {c.status === 'PENDING' && canEdit && <ChequeActions chequeId={c.id} />}
                </Cell>
              </Row>
            );
          })}
        </Table>
      )}

      {canEdit && (
        <Card>
          <h2 className="t-heading">Record a cheque</h2>
          <p className="t-small muted mt-1 max-w-prose">
            Attaching a learner is optional but worth doing: it is what makes a second bounce
            visible on their account rather than a surprise.
          </p>
          <div className="mt-4">
            <NewCheque learners={learners} currency={tenant.currency} defaultDate={today} />
          </div>
        </Card>
      )}
    </div>
  );
}
