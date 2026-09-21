import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { batchWhere, learnerWhere, staffScope } from '@/lib/scope';
import { formatMoney } from '@/lib/money';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { CancelPass, PlanForm, PlanToggle, SaleForm, type BatchOption, type PlanRow } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Prepaid passes: what is on sale, the form the counter sells from, and
 * every pass out there with how much of it is left. Selling needs the fee
 * permission, since money changes hands; looking needs the same.
 */
export default async function PassesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const me = await requireStaff('sales.fee_tracking', 'view');
  const canSell = me.permissions['sales.fee_tracking']?.edit ?? false;
  const canCancel = me.permissions['sales.fee_tracking']?.delete ?? false;
  const scope = await staffScope(me);
  const sp = await searchParams;
  const prefill = (Array.isArray(sp.learner) ? sp.learner[0] : sp.learner) ?? '';

  const [plans, courses, batches, passes] = await Promise.all([
    db.passPlan.findMany({ where: { organizationId: tenant.organizationId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
    db.product.findMany({ where: { organizationId: tenant.organizationId, type: 'COURSE', deletedAt: null }, orderBy: { title: 'asc' }, select: { id: true, title: true } }),
    db.batch.findMany({
      where: { organizationId: tenant.organizationId, deletedAt: null, status: { in: ['UPCOMING', 'ACTIVE'] }, ...batchWhere(scope) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, status: true, course: { select: { productId: true } } },
    }),
    db.prepaidPass.findMany({
      where: { organizationId: tenant.organizationId, user: learnerWhere(scope) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      select: { id: true, classesTotal: true, classesUsed: true, expiresAt: true, status: true, createdAt: true, enrollmentId: true, plan: { select: { name: true } }, user: { select: { id: true, name: true, registrationNo: true } } },
    }),
  ]);
  const enrolmentIds = passes.map((p) => p.enrollmentId).filter((x): x is string => Boolean(x));
  const batchOf = new Map(
    (enrolmentIds.length ? await db.enrollment.findMany({ where: { organizationId: tenant.organizationId, id: { in: enrolmentIds } }, select: { id: true, batch: { select: { id: true, name: true } } } }) : []).map((e) => [e.id, e.batch]),
  );

  const planRows: PlanRow[] = plans.map((p) => ({ id: p.id, name: p.name, classes: p.classes, validityDays: p.validityDays, priceRupees: Math.round(p.pricePaise / 100), productId: p.productId, isActive: p.isActive }));
  const batchOptions: BatchOption[] = batches.map((b) => ({ id: b.id, name: b.name, productId: b.course.productId, status: b.status }));
  const live = passes.filter((p) => p.status === 'ACTIVE');

  return (
    <div className="space-y-6">
      <PageHeader title="Prepaid passes" description="So many classes bought at the counter, used up one class at a time as the register marks them present, and gone when the validity runs out." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="font-semibold">Sell a pass</p>
          <p className="t-small faint mt-0.5">The learner gets a place on the batch and the classes on the pass. A receipt is issued for what is taken.</p>
          <div className="mt-4">
            {!canSell ? (
              <p className="t-small faint">Selling needs the fee permission.</p>
            ) : planRows.filter((p) => p.isActive).length === 0 ? (
              <p className="t-small faint">Add a plan on the right first.</p>
            ) : (
              <SaleForm plans={planRows.filter((p) => p.isActive)} batches={batchOptions} prefill={prefill} />
            )}
          </div>
        </Card>

        <Card>
          <p className="font-semibold">What is on sale</p>
          {planRows.length === 0 ? (
            <p className="t-small faint mt-1">No plans yet.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {planRows.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {p.name} {!p.isActive && <Badge tone="neutral">off sale</Badge>}
                    </p>
                    <p className="t-small faint">
                      {p.classes} classes{p.validityDays ? `, ${p.validityDays} days` : ', no expiry'}, {formatMoney(p.priceRupees * 100, tenant.currency)}
                      {p.productId ? ` · ${courses.find((c) => c.id === p.productId)?.title ?? 'one course'}` : ' · any course'}
                    </p>
                  </div>
                  {canSell && <PlanToggle id={p.id} isActive={p.isActive} />}
                </li>
              ))}
            </ul>
          )}
          {canSell && (
            <details className="mt-4">
              <summary className="t-small cursor-pointer font-medium">Add a plan</summary>
              <div className="mt-3">
                <PlanForm draft={null} courses={courses} />
              </div>
            </details>
          )}
        </Card>
      </div>

      <Card>
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          Passes <Badge tone="brand">{live.length} live</Badge>
        </p>
        {passes.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No pass sold yet" hint="The first one sold appears here with how many classes are left on it." />
          </div>
        ) : (
          <div className="mt-3">
            <Table head={['Learner', 'Pass', 'Batch', 'Used', 'Valid until', 'Status', '']}>
              {passes.map((p) => {
                const batch = p.enrollmentId ? batchOf.get(p.enrollmentId) : null;
                const left = Math.max(0, p.classesTotal - p.classesUsed);
                return (
                  <Row key={p.id}>
                    <Cell>
                      <Link href={`/admin/learners/${p.user.id}`} className="font-medium underline-offset-2 hover:underline">
                        {p.user.name}
                      </Link>
                      {p.user.registrationNo && <span className="t-small faint"> #{p.user.registrationNo}</span>}
                    </Cell>
                    <Cell>{p.plan.name}</Cell>
                    <Cell>{batch ? <Link href={`/admin/batches/${batch.id}`} className="underline-offset-2 hover:underline">{batch.name}</Link> : <span className="faint">–</span>}</Cell>
                    <Cell>
                      <span className="tabular-nums">
                        {p.classesUsed} of {p.classesTotal}
                      </span>
                      {p.status === 'ACTIVE' && <span className="t-small faint"> · {left} left</span>}
                    </Cell>
                    <Cell>{p.expiresAt ? p.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : <span className="faint">no expiry</span>}</Cell>
                    <Cell>
                      <Badge tone={p.status === 'ACTIVE' ? 'ok' : p.status === 'USED_UP' ? 'neutral' : p.status === 'EXPIRED' ? 'warn' : 'bad'}>{p.status.toLowerCase().replace('_', ' ')}</Badge>
                    </Cell>
                    <Cell>{canCancel && p.status === 'ACTIVE' ? <CancelPass id={p.id} /> : null}</Cell>
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
