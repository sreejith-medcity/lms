import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { AGE_BUCKETS, summariseAccount, worstFirst, type AgeBucket } from '@/lib/dues';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { PlanForm } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Who owes what, worst first.
 *
 * The question the office asks every morning is not "what is the outstanding
 * total" but "who do I call today". So the list is ordered by how long the
 * oldest unpaid instalment has been waiting, then by how much, and every row
 * is one learner on one plan with the next thing to say to them.
 */

const BUCKET_TONE: Record<AgeBucket, 'neutral' | 'brand' | 'ok' | 'warn' | 'bad'> = {
  D60_PLUS: 'bad',
  D31_60: 'bad',
  D8_30: 'warn',
  D1_7: 'warn',
  DUE_SOON: 'brand',
  CURRENT: 'neutral',
};

const dateLabel = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function FeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; branch?: string; course?: string; bucket?: string; show?: string }>;
}) {
  const tenant = await requireTenant();
  await requireStaff('sales.fee_tracking', 'view');
  const { q, branch, course, bucket, show } = await searchParams;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [plans, branches, courses, collectedThisMonth, withoutPlan] = await Promise.all([
    db.enrollment.findMany({
      where: {
        organizationId: tenant.organizationId,
        instalments: { some: {} },
        ...(branch ? { branchId: branch } : {}),
        ...(course ? { productId: course } : {}),
        ...(q
          ? {
              user: {
                OR: [
                  { name: { contains: q, mode: 'insensitive' as const } },
                  { email: { contains: q, mode: 'insensitive' as const } },
                  { phone: { contains: q } },
                ],
              },
            }
          : {}),
      },
      select: {
        id: true,
        user: { select: { name: true, email: true, phone: true } },
        product: { select: { title: true } },
        branch: { select: { name: true } },
        instalments: {
          select: { id: true, sequence: true, amountPaise: true, paidPaise: true, dueDate: true, paidAt: true },
        },
      },
    }),
    db.branch.findMany({
      where: { organizationId: tenant.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.product.findMany({
      where: { organizationId: tenant.organizationId, enrollments: { some: { instalments: { some: {} } } } },
      orderBy: { title: 'asc' },
      select: { id: true, title: true },
    }),
    db.payment.aggregate({
      where: {
        organizationId: tenant.organizationId,
        status: 'CAPTURED',
        capturedAt: { gte: monthStart },
        gateway: { in: ['CASH', 'CHEQUE', 'BANK', 'MANUAL'] },
      },
      _sum: { amountPaise: true },
      _count: true,
    }),
    db.enrollment.findMany({
      where: {
        organizationId: tenant.organizationId,
        status: 'ENROLLED',
        isFreePreview: false,
        instalments: { none: {} },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, user: { select: { name: true } }, product: { select: { title: true } } },
    }),
  ]);

  const accounts = worstFirst(
    plans.map((p) => ({ ...p, summary: summariseAccount(p.instalments, now) })),
  );

  const open = accounts.filter((a) => !a.summary.settled);
  const settled = accounts.filter((a) => a.summary.settled);

  const outstanding = open.reduce((n, a) => n + a.summary.balancePaise, 0);
  const overdue = open.reduce((n, a) => n + a.summary.overduePaise, 0);
  const overdueAccounts = open.filter((a) => a.summary.overduePaise > 0).length;
  const dueSoon = open.filter((a) => a.summary.bucket === 'DUE_SOON');

  const byBucket = AGE_BUCKETS.map((b) => {
    const rows = open.filter((a) => a.summary.bucket === b.key);
    return { ...b, count: rows.length, paise: rows.reduce((n, a) => n + a.summary.balancePaise, 0) };
  });

  const listed =
    show === 'settled' ? settled : bucket ? open.filter((a) => a.summary.bucket === bucket) : open;

  const link = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, branch, course, bucket, show, ...over })) {
      if (v) params.set(k, v);
    }
    const s = params.toString();
    return s ? `/admin/fees?${s}` : '/admin/fees';
  };

  return (
    <div>
      <PageHeader
        title="Fees and dues"
        description="Who owes what, oldest first. Open a learner to take a payment, print a receipt or send a reminder."
      />

      <div className="space-y-6">
        <StatGrid>
          <Stat
            label="Outstanding"
            value={formatMoney(outstanding, tenant.currency)}
            sub={`${open.length} plans with a balance`}
          />
          <Stat
            label="Overdue"
            value={formatMoney(overdue, tenant.currency)}
            sub={`${overdueAccounts} learners past a due date`}
          />
          <Stat label="Due this week" value={String(dueSoon.length)} sub="worth a call before they lapse" />
          <Stat
            label="Collected at the counter"
            value={formatMoney(collectedThisMonth._sum.amountPaise ?? 0, tenant.currency)}
            sub={`${collectedThisMonth._count} receipts this month`}
          />
        </StatGrid>

        {/* Ageing strip: the shape of the book at a glance, and a filter. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {byBucket.map((b) => {
            const active = bucket === b.key && show !== 'settled';
            return (
              <Link
                key={b.key}
                href={link({ bucket: active ? undefined : b.key, show: undefined })}
                className={`rounded-[var(--radius-sm)] border px-3 py-2 transition ${
                  active ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'hover:bg-[var(--surface-2)]'
                }`}
              >
                <p className="t-small faint">{b.label}</p>
                <p className="mt-0.5 font-semibold tabular-nums">{formatMoney(b.paise, tenant.currency)}</p>
                <p className="t-small faint">{b.count} {b.count === 1 ? 'learner' : 'learners'}</p>
              </Link>
            );
          })}
        </div>

        <form className="flex flex-wrap items-end gap-2" action="/admin/fees" method="get">
          {bucket && <input type="hidden" name="bucket" value={bucket} />}
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Name, phone or email"
            className="h-9 min-w-[14rem] flex-1 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 text-sm"
            aria-label="Search"
          />
          {branches.length > 1 && (
            <select name="branch" defaultValue={branch ?? ''} className="h-9 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 text-sm" aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <select name="course" defaultValue={course ?? ''} className="h-9 max-w-[16rem] rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 text-sm" aria-label="Course">
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
          <button type="submit" className="h-9 rounded-[var(--radius-sm)] border px-3 text-sm font-medium hover:bg-[var(--surface-2)]">
            Filter
          </button>
          <Link href={link({ show: show === 'settled' ? undefined : 'settled', bucket: undefined })} className="t-small ml-auto underline">
            {show === 'settled' ? `Back to open (${open.length})` : `Paid up (${settled.length})`}
          </Link>
        </form>

        {listed.length === 0 ? (
          <EmptyState
            title={show === 'settled' ? 'Nobody is fully paid up yet' : accounts.length ? 'Nothing owed here' : 'No fee plans yet'}
            hint={
              accounts.length
                ? 'Try a different filter.'
                : 'A learner who buys an instalment plan online gets a schedule automatically. For somebody paying at the counter, split their fee below.'
            }
          />
        ) : (
          <Table head={['Learner', 'Course', 'Balance', 'Overdue', 'Next due', 'Age', '']}>
            {listed.map((a) => (
              <Row key={a.id}>
                <Cell>
                  <Link href={`/admin/fees/${a.id}`} className="font-medium hover:underline">
                    {a.user.name}
                  </Link>
                  <span className="t-small faint block">{a.user.phone ?? a.user.email ?? ''}</span>
                </Cell>
                <Cell>
                  <span className="block">{a.product.title}</span>
                  {branches.length > 1 && <span className="t-small faint block">{a.branch.name}</span>}
                </Cell>
                <Cell className="tabular-nums">
                  <span className="font-medium">{formatMoney(a.summary.balancePaise, tenant.currency)}</span>
                  <span className="t-small faint block">of {formatMoney(a.summary.totalPaise, tenant.currency)}</span>
                </Cell>
                <Cell className="tabular-nums">
                  {a.summary.overduePaise > 0 ? (
                    <span className="text-[var(--bad)]">{formatMoney(a.summary.overduePaise, tenant.currency)}</span>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </Cell>
                <Cell>
                  {a.summary.nextDue ? (
                    <>
                      <span className="block tabular-nums">{dateLabel(a.summary.nextDue.dueDate)}</span>
                      <span className="t-small faint block">
                        #{a.summary.nextDue.sequence} · {formatMoney(a.summary.nextDue.balancePaise, tenant.currency)}
                      </span>
                    </>
                  ) : (
                    <Badge tone="ok">paid up</Badge>
                  )}
                </Cell>
                <Cell>
                  {a.summary.settled ? null : (
                    <Badge tone={BUCKET_TONE[a.summary.bucket]}>
                      {a.summary.oldestOverdueDays > 0
                        ? `${a.summary.oldestOverdueDays}d late`
                        : a.summary.bucket === 'DUE_SOON'
                          ? 'due soon'
                          : 'on time'}
                    </Badge>
                  )}
                </Cell>
                <Cell>
                  <Link href={`/admin/fees/${a.id}`} className="t-small whitespace-nowrap underline">
                    Take payment
                  </Link>
                </Cell>
              </Row>
            ))}
          </Table>
        )}

        {withoutPlan.length > 0 && (
          <Card>
            <h2 className="t-heading">Split a fee into instalments</h2>
            <p className="t-small muted mt-1">
              For a learner paying in parts at the counter. Anyone who buys an instalment plan online
              already has a schedule. The remainder lands on the first instalment, so the parts always
              add back up to the total exactly.
            </p>
            <div className="mt-5">
              <PlanForm
                enrollments={withoutPlan.map((e) => ({
                  id: e.id,
                  label: `${e.user.name} · ${e.product.title}`,
                }))}
              />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
