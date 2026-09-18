import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { childOf, getParentSession } from '@/lib/parent-session';
import { balanceOf, summariseAccount } from '@/lib/dues';
import { feeStatusLabel } from '@/lib/misc-fees';
import { failedOrders, inFlightFor, instalmentState, payOffer, processingOrders } from '@/lib/parent-fees';
import { formatMoney } from '@/lib/money';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';
import { paymentsAvailable } from '@/lib/payments';
import { Badge, Card, Cell, Row, Table } from '@/components/ui';
import { ParentPay } from './pay';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fees', robots: { index: false, follow: false } };

/**
 * The parent's fee screen, per child and enrolment: the agreed fee, what
 * is confirmed paid, what is outstanding, the instalment schedule, the
 * next payment with anything overdue shown apart, the other charges,
 * every payment with its receipt, and a Pay button. The ledger here is
 * the academy's own, so the figures are live; a payment the gateway has
 * not confirmed shows as Processing rather than as paid or as missing.
 */
export default async function ParentFees({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params;
  const tenant = await requireTenant();
  const session = await getParentSession();
  if (!session) redirect('/parent/login');
  const child = await childOf(tenant.organizationId, session.contact, childId);
  if (!child) notFound();
  const tz = tenant.timezone;
  const now = new Date();
  const day = (d: Date) => formatDayLabel(dayKey(d, tz), tz);
  const money = (p: number) => formatMoney(p, tenant.currency);

  const [enrolments, charges, orders, payments, tax, online] = await Promise.all([
    db.enrollment.findMany({
      where: { organizationId: tenant.organizationId, userId: child.id, instalments: { some: {} } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, product: { select: { title: true } }, batch: { select: { name: true } }, instalments: { orderBy: { sequence: 'asc' }, select: { id: true, sequence: true, amountPaise: true, paidPaise: true, dueDate: true, paidAt: true } } },
    }),
    db.miscFee.findMany({
      where: { organizationId: tenant.organizationId, userId: child.id, status: { in: ['PENDING', 'PAID', 'WAIVED'] } },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      select: { id: true, label: true, amountPaise: true, dueDate: true, status: true, paidAt: true, waivedReason: true, enrollment: { select: { product: { select: { title: true } } } } },
    }),
    // Orders still in flight tell the parent a payment is processing, or
    // that the last attempt failed or was cancelled, before another is offered.
    db.order.findMany({
      where: { organizationId: tenant.organizationId, userId: child.id, status: { in: ['PENDING', 'FAILED', 'CANCELLED'] }, placedAt: { gte: new Date(now.getTime() - 7 * 864e5) }, items: { some: { OR: [{ instalmentId: { not: null } }, { miscFeeId: { not: null } }] } } },
      orderBy: { placedAt: 'desc' },
      select: { id: true, orderNo: true, status: true, totalPaise: true, placedAt: true, gatewayOrderId: true, items: { select: { instalmentId: true, miscFeeId: true, titleSnapshot: true } } },
    }),
    db.payment.findMany({
      where: { organizationId: tenant.organizationId, userId: child.id, status: { in: ['CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { id: true, receiptNo: true, amountPaise: true, capturedAt: true, createdAt: true, method: true, gateway: true, gatewayRef: true, status: true, raw: true, refunds: { select: { amountPaise: true, createdAt: true } } },
    }),
    db.taxConfig.findFirst({ where: { organizationId: tenant.organizationId }, select: { enabled: true, pricesAreExclusive: true } }),
    paymentsAvailable(tenant.organizationId).catch(() => false),
  ]);

  const processing = processingOrders(orders);
  const failed = failedOrders(orders);

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/parent/${child.id}`} className="t-small faint hover:underline">
          {child.name}
        </Link>
        <h1 className="t-title mt-1">Fees</h1>
        <p className="t-small faint mt-1">
          Figures are the academy&rsquo;s own ledger, live.
          {tax?.enabled ? (tax.pricesAreExclusive ? ' Course fees are shown before tax; tax is added at payment and printed on the receipt.' : ' Fees include applicable tax.') : ''}
        </p>
      </div>

      {processing.length > 0 && (
        <Card>
          <h2 className="t-heading">Processing</h2>
          <ul className="mt-2 divide-y text-sm">
            {processing.map((o) => (
              <li key={o.id} className="py-2">
                <p>
                  {o.items.map((i) => i.titleSnapshot).join(', ')} · {money(o.totalPaise)} · started {day(o.placedAt)} {formatTime(o.placedAt, tz)}
                </p>
                <p className="t-micro faint">
                  Reference {o.orderNo}. Waiting for the bank&rsquo;s confirmation; nothing is counted as paid until it arrives.{' '}
                  <Link href={`/checkout/${o.id}?as=parent&child=${child.id}`} className="underline">
                    Check status
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {failed.length > 0 && (
        <Card>
          <h2 className="t-heading">Did not go through</h2>
          <ul className="mt-2 divide-y text-sm">
            {failed.map((o) => (
              <li key={o.id} className="py-2">
                {o.items.map((i) => i.titleSnapshot).join(', ')} · {money(o.totalPaise)} · {day(o.placedAt)} · <Badge tone="bad">{o.status === 'FAILED' ? 'failed' : 'cancelled'}</Badge>
                <p className="t-micro faint">Nothing was charged. Reference {o.orderNo}.</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {enrolments.length === 0 && charges.length === 0 && (
        <Card>
          <p className="t-small muted">No fee plan on record for {child.name}. If that is unexpected, ask the branch.</p>
        </Card>
      )}

      {enrolments.map((e) => {
        const s = summariseAccount(e.instalments, now);
        const overdue = e.instalments.filter((i) => balanceOf(i) > 0 && i.dueDate < now);
        const next = e.instalments.find((i) => balanceOf(i) > 0) ?? null;
        const offer = payOffer({ next, inFlight: next ? inFlightFor(orders, { instalmentId: next.id }) !== null : false, online });
        return (
          <Card key={e.id}>
            <h2 className="t-heading">
              {e.product.title}
              {e.batch ? <span className="t-small faint font-normal"> · {e.batch.name}</span> : null}
            </h2>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="t-micro faint">Agreed fee</dt>
                <dd className="font-medium tabular-nums">{money(s.totalPaise)}</dd>
              </div>
              <div>
                <dt className="t-micro faint">Confirmed paid</dt>
                <dd className="font-medium tabular-nums">{money(s.paidPaise)}</dd>
              </div>
              <div>
                <dt className="t-micro faint">Outstanding</dt>
                <dd className="font-medium tabular-nums">{money(s.balancePaise)}</dd>
              </div>
            </dl>

            {overdue.length > 0 && (
              <p className="t-small mt-3 rounded-[var(--radius-sm)] border border-[var(--bad)] px-3 py-2 text-[var(--bad)]">
                Overdue: {money(s.overduePaise)} across {overdue.length} instalment{overdue.length === 1 ? '' : 's'}, the oldest by {s.oldestOverdueDays} day{s.oldestOverdueDays === 1 ? '' : 's'}.
              </p>
            )}

            {next && offer !== 'nothing-due' ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2">
                <div>
                  <p className="t-micro faint">Next payment</p>
                  <p className="text-sm">
                    Instalment {next.sequence} of {e.instalments.length} · <span className="font-medium tabular-nums">{money(balanceOf(next))}</span> · due {day(next.dueDate)}
                    {next.dueDate < now ? <Badge tone="bad">overdue</Badge> : null}
                  </p>
                </div>
                {offer === 'processing' ? (
                  <Badge tone="warn">processing</Badge>
                ) : offer === 'pay-online' ? (
                  <ParentPay childId={child.id} childName={child.name} id={next.id} kind="instalment" amountLabel={money(balanceOf(next))} label="Pay online" />
                ) : (
                  <span className="t-small faint">Pay at the academy</span>
                )}
              </div>
            ) : (
              <p className="t-small mt-3 text-[var(--ok)]">Fully paid.</p>
            )}

            <div className="mt-3">
              <Table head={['Instalment', 'Due', 'Amount', 'Paid', 'Remaining', 'Status']}>
                {e.instalments.map((i) => {
                  const bal = balanceOf(i);
                  const state = instalmentState(i, inFlightFor(orders, { instalmentId: i.id }) !== null, now);
                  return (
                    <Row key={i.id}>
                      <Cell>{i.sequence}</Cell>
                      <Cell className="tabular-nums">{day(i.dueDate)}</Cell>
                      <Cell className="tabular-nums">{money(i.amountPaise)}</Cell>
                      <Cell className="tabular-nums">{money(Math.min(i.paidPaise, i.amountPaise))}</Cell>
                      <Cell className="tabular-nums">{money(bal)}</Cell>
                      <Cell>
                        {state === 'paid' ? <Badge tone="ok">paid{i.paidAt ? ` ${day(i.paidAt)}` : ''}</Badge> : state === 'processing' ? <Badge tone="warn">processing</Badge> : state === 'part-paid' ? <Badge tone="warn">part paid</Badge> : state === 'overdue' ? <Badge tone="bad">overdue</Badge> : <Badge tone="neutral">due</Badge>}
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            </div>
          </Card>
        );
      })}

      {charges.length > 0 && (
        <Card>
          <h2 className="t-heading">Other charges</h2>
          <ul className="mt-2 divide-y">
            {charges.map((c) => {
              const label = feeStatusLabel(c, now);
              const flight = c.status === 'PENDING' ? inFlightFor(orders, { miscFeeId: c.id }) : null;
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p>
                      {c.label} <span className="faint">· {c.enrollment.product.title}</span>
                    </p>
                    <p className="t-micro faint">
                      {money(c.amountPaise)}
                      {c.dueDate ? ` · due ${day(c.dueDate)}` : ''}
                      {c.status === 'WAIVED' && c.waivedReason ? ` · waived: ${c.waivedReason}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={label.tone}>{label.text}</Badge>
                    {c.status === 'PENDING' && (flight ? <Badge tone="warn">processing</Badge> : online ? <ParentPay childId={child.id} childName={child.name} id={c.id} kind="fee" amountLabel={money(c.amountPaise)} label="Pay" /> : null)}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="t-heading">Payments and receipts</h2>
        {payments.length === 0 ? (
          <p className="t-small muted mt-2">No payments recorded.</p>
        ) : (
          <div className="mt-2">
            <Table head={['Date', 'For', 'Amount', 'Mode', 'Status', 'Receipt']}>
              {payments.map((p) => {
                const raw = (p.raw ?? {}) as { item?: string };
                const refunded = p.refunds.reduce((n, r) => n + r.amountPaise, 0);
                return (
                  <Row key={p.id}>
                    <Cell className="tabular-nums">{day(p.capturedAt ?? p.createdAt)}</Cell>
                    <Cell>{raw.item ?? 'Fee'}</Cell>
                    <Cell className="tabular-nums">
                      {money(p.amountPaise)}
                      {refunded > 0 && <p className="t-micro faint">{money(refunded)} refunded</p>}
                    </Cell>
                    <Cell className="t-small">
                      {p.method ?? p.gateway.toLowerCase()}
                      {p.gatewayRef ? <p className="t-micro faint font-mono">{p.gatewayRef}</p> : null}
                    </Cell>
                    <Cell>
                      <Badge tone={p.status === 'CAPTURED' ? 'ok' : 'warn'}>{p.status === 'CAPTURED' ? 'confirmed' : p.status === 'REFUNDED' ? 'refunded' : 'part refunded'}</Badge>
                    </Cell>
                    <Cell>
                      {p.receiptNo ? (
                        <a href={`/api/receipts/${encodeURIComponent(p.receiptNo)}/pdf`} target="_blank" rel="noreferrer" className="t-small underline">
                          {p.receiptNo}
                        </a>
                      ) : (
                        <span className="t-small faint">receipt pending</span>
                      )}
                    </Cell>
                  </Row>
                );
              })}
            </Table>
          </div>
        )}
        <p className="t-micro faint mt-2">A payment appears here once the bank confirms it. A confirmed payment whose receipt is still being written shows &ldquo;receipt pending&rdquo; for a minute or two.</p>
      </Card>
    </div>
  );
}
