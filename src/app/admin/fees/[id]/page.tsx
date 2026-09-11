import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { balanceOf, daysOverdue, summariseAccount } from '@/lib/dues';
import { Badge, Card, Cell, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { CounterPaymentForm, ReminderButton } from '../editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const dateLabel = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * One learner's statement: the schedule, every receipt against it, and the
 * form the cashier uses. The form takes an amount, not an instalment: the
 * office takes what is in hand and the ledger works out where it lands.
 */
export default async function FeeStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await requireTenant();
  const me = await requireStaff('sales.fee_tracking', 'view');
  const canEdit = me.permissions['sales.fee_tracking']?.edit ?? false;
  const { id } = await params;

  const enrollment = await db.enrollment.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
      product: { select: { title: true } },
      branch: { select: { name: true } },
      batch: { select: { name: true } },
      instalments: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          amountPaise: true,
          paidPaise: true,
          dueDate: true,
          paidAt: true,
          paymentId: true,
          reminderSentAt: true,
        },
      },
    },
  });
  if (!enrollment) notFound();

  const now = new Date();
  const summary = summariseAccount(enrollment.instalments, now);

  // Every payment that touched this plan: counter receipts carry the
  // enrolment on the row, online ones are found through the order line.
  const payments = await db.payment.findMany({
    where: {
      organizationId: tenant.organizationId,
      status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
      OR: [
        { raw: { path: ['enrollmentId'], equals: enrollment.id } },
        { order: { items: { some: { instalmentId: { in: enrollment.instalments.map((i) => i.id) } } } } },
        { id: { in: enrollment.instalments.flatMap((i) => (i.paymentId ? [i.paymentId] : [])) } },
      ],
    },
    orderBy: { capturedAt: 'desc' },
    select: {
      id: true,
      receiptNo: true,
      gateway: true,
      method: true,
      amountPaise: true,
      capturedAt: true,
      createdAt: true,
      raw: true,
      order: { select: { orderNo: true, invoice: { select: { invoiceNo: true } } } },
    },
  });

  const reminders = await db.notificationLog.findMany({
    where: {
      organizationId: tenant.organizationId,
      eventKey: 'instalment.due',
      userId: enrollment.user.id,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, channel: true, status: true, createdAt: true, sentAt: true },
  });

  return (
    <div>
      <PageHeader
        title={enrollment.user.name}
        description={`${enrollment.product.title}${enrollment.batch ? ` · ${enrollment.batch.name}` : ''} · ${enrollment.branch.name}`}
        action={
          <Link href="/admin/fees" className="t-small underline">
            All dues
          </Link>
        }
      />

      <div className="space-y-6">
        <StatGrid>
          <Stat label="Fee" value={formatMoney(summary.totalPaise, tenant.currency)} sub={`${enrollment.instalments.length} instalments`} />
          <Stat label="Paid" value={formatMoney(summary.paidPaise, tenant.currency)} />
          <Stat
            label="Balance"
            value={formatMoney(summary.balancePaise, tenant.currency)}
            sub={summary.overduePaise > 0 ? `${formatMoney(summary.overduePaise, tenant.currency)} overdue` : summary.settled ? 'paid up' : 'nothing overdue'}
          />
          <Stat
            label="Next due"
            value={summary.nextDue ? dateLabel(summary.nextDue.dueDate) : '—'}
            sub={summary.nextDue ? `#${summary.nextDue.sequence} · ${formatMoney(summary.nextDue.balancePaise, tenant.currency)}` : undefined}
          />
        </StatGrid>

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-6">
            <Card>
              <h2 className="t-heading">Schedule</h2>
              <div className="mt-3">
                <Table head={['#', 'Due', 'Amount', 'Paid', 'Balance', 'Status']}>
                  {enrollment.instalments.map((i) => {
                    const balance = balanceOf(i);
                    const late = balance > 0 ? daysOverdue(i.dueDate, now) : 0;
                    return (
                      <Row key={i.id}>
                        <Cell className="tabular-nums">{i.sequence}</Cell>
                        <Cell className="tabular-nums">{dateLabel(i.dueDate)}</Cell>
                        <Cell className="tabular-nums">{formatMoney(i.amountPaise, tenant.currency)}</Cell>
                        <Cell className="tabular-nums">{i.paidPaise > 0 ? formatMoney(i.paidPaise, tenant.currency) : <span className="faint">—</span>}</Cell>
                        <Cell className="tabular-nums">{balance > 0 ? formatMoney(balance, tenant.currency) : <span className="faint">—</span>}</Cell>
                        <Cell>
                          {balance <= 0 ? (
                            <Badge tone="ok">paid {i.paidAt ? dateLabel(i.paidAt) : ''}</Badge>
                          ) : i.paidPaise > 0 ? (
                            <Badge tone={late > 0 ? 'bad' : 'warn'}>part paid{late > 0 ? `, ${late}d late` : ''}</Badge>
                          ) : late > 0 ? (
                            <Badge tone="bad">{late}d late</Badge>
                          ) : late >= -7 ? (
                            <Badge tone="brand">due soon</Badge>
                          ) : (
                            <Badge tone="neutral">later</Badge>
                          )}
                          {i.reminderSentAt && (
                            <span className="t-small faint block">reminded {dateLabel(i.reminderSentAt)}</span>
                          )}
                        </Cell>
                      </Row>
                    );
                  })}
                </Table>
              </div>
            </Card>

            <Card>
              <h2 className="t-heading">Receipts</h2>
              {payments.length === 0 ? (
                <p className="t-small faint mt-2">Nothing collected yet.</p>
              ) : (
                <div className="mt-3">
                  <Table head={['Receipt', 'When', 'How', 'Against', 'Amount']}>
                    {payments.map((p) => {
                      const raw = (p.raw ?? {}) as { allocations?: { sequence: number; paise: number }[]; note?: string | null };
                      const against = raw.allocations?.length
                        ? raw.allocations.map((a) => `#${a.sequence}`).join(', ')
                        : p.order?.orderNo ?? '';
                      const no = p.receiptNo ?? p.order?.invoice?.invoiceNo ?? null;
                      const href = p.receiptNo
                        ? `/learn/receipts/${p.receiptNo}`
                        : p.order?.invoice?.invoiceNo
                          ? `/learn/invoices/${p.order.invoice.invoiceNo}`
                          : null;
                      return (
                        <Row key={p.id}>
                          <Cell>
                            {href && no ? (
                              <Link href={href} className="font-medium tabular-nums underline" target="_blank">
                                {no}
                              </Link>
                            ) : (
                              <span className="faint">—</span>
                            )}
                            {raw.note && <span className="t-small faint block">{raw.note}</span>}
                          </Cell>
                          <Cell className="tabular-nums">{dateLabel(p.capturedAt ?? p.createdAt)}</Cell>
                          <Cell>{p.method ?? p.gateway.toLowerCase()}</Cell>
                          <Cell className="tabular-nums">{against}</Cell>
                          <Cell className="tabular-nums">{formatMoney(p.amountPaise, tenant.currency)}</Cell>
                        </Row>
                      );
                    })}
                  </Table>
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            {canEdit && !summary.settled && (
              <Card>
                <h2 className="t-heading">Take a payment</h2>
                <p className="t-small muted mt-1">
                  Enter what was received. It settles the oldest instalment first; anything left over
                  goes towards the next one.
                </p>
                <div className="mt-4">
                  <CounterPaymentForm
                    enrollmentId={enrollment.id}
                    balanceRupees={summary.balancePaise / 100}
                    nextRupees={summary.nextDue ? summary.nextDue.balancePaise / 100 : summary.balancePaise / 100}
                  />
                </div>
              </Card>
            )}

            <Card>
              <h2 className="t-heading">Contact</h2>
              <p className="mt-2 text-sm">{enrollment.user.name}</p>
              {enrollment.user.phone && (
                <a href={`tel:${enrollment.user.phone}`} className="t-small block underline">{enrollment.user.phone}</a>
              )}
              {enrollment.user.email && (
                <a href={`mailto:${enrollment.user.email}`} className="t-small block underline">{enrollment.user.email}</a>
              )}
              <p className="t-small faint mt-2">Enrolled {dateLabel(enrollment.createdAt)}</p>
              <Link href={`/admin/learners/${enrollment.user.id}`} className="t-small mt-2 block underline">
                Learner profile
              </Link>
              {canEdit && !summary.settled && (
                <div className="mt-4">
                  <ReminderButton enrollmentId={enrollment.id} />
                </div>
              )}
            </Card>

            <Card>
              <h2 className="t-heading">Reminders sent</h2>
              {reminders.length === 0 ? (
                <p className="t-small faint mt-2">None yet. The scheduler sends one three days before each due date, then a day, a week and a fortnight after.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {reminders.map((r) => (
                    <li key={r.id} className="t-small flex justify-between gap-2">
                      <span>{r.channel.toLowerCase()} · {r.status.toLowerCase()}</span>
                      <span className="faint tabular-nums">{dateLabel(r.sentAt ?? r.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
