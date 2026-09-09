import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Badge, Card, Cell, EmptyState, Row, Table, ProgressRing } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { ResetPassword } from './controls';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function LearnerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('learner.learner_management', 'view');
  const canEdit = me.permissions['learner.learner_management']?.edit ?? false;

  const learner = await db.user.findFirst({
    where: { id, organizationId: tenant.organizationId, kind: 'LEARNER', deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      registrationNo: true,
      createdAt: true,
      lastSeenAt: true,
      mustResetPassword: true,
      enrollments: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          progressPercent: true,
          createdAt: true,
          source: true,
          expiresAt: true,
          product: { select: { id: true, title: true } },
          batch: { select: { name: true } },
        },
      },
      orders: {
        orderBy: { placedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          orderNo: true,
          status: true,
          totalPaise: true,
          currency: true,
          placedAt: true,
          invoice: { select: { invoiceNo: true } },
        },
      },
      attendances: { select: { status: true } },
      certificates: {
        where: { revokedAt: null },
        select: { id: true, serialNo: true, verifyToken: true },
      },
    },
  });
  if (!learner) notFound();

  const paid = learner.orders
    .filter((o) => o.status === 'PAID')
    .reduce((n, o) => n + o.totalPaise, 0);

  const present = learner.attendances.filter(
    (a) => a.status === 'PRESENT' || a.status === 'LATE',
  ).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/learners" className="t-small faint hover:underline">
            Learners
          </Link>
          <h1 className="t-title mt-1 flex flex-wrap items-center gap-2">
            {learner.name}
            {learner.status !== 'ACTIVE' && (
              <Badge tone="warn">{learner.status.toLowerCase().replace('_', ' ')}</Badge>
            )}
            {learner.mustResetPassword && <Badge tone="warn">password not set</Badge>}
          </h1>
          <p className="t-small faint mt-1">
            {[learner.email, learner.phone].filter(Boolean).join(' · ') || 'No contact details'}
            {learner.registrationNo ? ` · registration ${learner.registrationNo}` : ''}
          </p>
          <p className="t-small faint mt-1">
            Joined{' '}
            {learner.createdAt.toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
            {learner.lastSeenAt
              ? ` · last seen ${learner.lastSeenAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
              : ' · never signed in'}
          </p>
        </div>

        {canEdit && <ResetPassword userId={learner.id} name={learner.name} />}
      </div>

      <div className="space-y-6">
        <StatGrid>
          <Stat label="Courses" value={String(learner.enrollments.length)} />
          <Stat label="Paid" value={formatMoney(paid, tenant.currency)} sub="across all orders" />
          <Stat label="Classes attended" value={String(present)} />
          <Stat label="Certificates" value={String(learner.certificates.length)} />
        </StatGrid>

        <section>
          <h2 className="t-heading mb-3">Enrolments</h2>
          {learner.enrollments.length === 0 ? (
            <EmptyState title="Not enrolled in anything" />
          ) : (
            <Card padded={false}>
              <ul className="divide-y">
                {learner.enrollments.map((e) => (
                  <li key={e.id} className="flex items-center gap-4 px-5 py-3">
                    <ProgressRing value={e.progressPercent} size={38} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{e.product.title}</p>
                      <p className="t-small faint">
                        {e.batch?.name ?? 'No batch'} · {e.status.toLowerCase()} ·{' '}
                        {e.source.toLowerCase().replace('_', ' ')}
                        {e.expiresAt
                          ? ` · expires ${e.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                          : ''}
                      </p>
                    </div>
                    <span className="t-small faint shrink-0">
                      {e.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        <section>
          <h2 className="t-heading mb-3">Orders</h2>
          {learner.orders.length === 0 ? (
            <EmptyState title="No orders" hint="Free and manually enrolled courses have none." />
          ) : (
            <Table head={['Order', 'Invoice', 'Status', 'Amount', 'When']}>
              {learner.orders.map((o) => (
                <Row key={o.id}>
                  <Cell className="font-mono text-xs">{o.orderNo}</Cell>
                  <Cell className="font-mono text-xs">{o.invoice?.invoiceNo ?? '—'}</Cell>
                  <Cell>
                    <Badge
                      tone={o.status === 'PAID' ? 'ok' : o.status === 'PENDING' ? 'warn' : 'bad'}
                    >
                      {o.status.toLowerCase().replace('_', ' ')}
                    </Badge>
                  </Cell>
                  <Cell className="tabular-nums">{formatMoney(o.totalPaise, o.currency)}</Cell>
                  <Cell className="t-small faint">
                    {o.placedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </section>

        {learner.certificates.length > 0 && (
          <section>
            <h2 className="t-heading mb-3">Certificates</h2>
            <Card padded={false}>
              <ul className="divide-y">
                {learner.certificates.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="font-mono text-xs">{c.serialNo}</span>
                    <a
                      href={`/verify/${c.verifyToken}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="t-small underline"
                    >
                      Open
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
