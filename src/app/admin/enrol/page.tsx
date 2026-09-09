import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { EnrolForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function EnrolPage() {
  const tenant = await requireTenant();
  await requireStaff('new_enrollment.single', 'view');

  const [products, learners, batches, recent] = await Promise.all([
    db.product.findMany({
      where: { organizationId: tenant.organizationId, type: 'COURSE', deletedAt: null },
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        course: { select: { id: true } },
        pricingPlans: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, pricePaise: true, currency: true, validityDays: true },
        },
      },
    }),
    db.user.findMany({
      where: { organizationId: tenant.organizationId, kind: 'LEARNER', deletedAt: null },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, email: true, phone: true },
    }),
    db.batch.findMany({
      where: {
        organizationId: tenant.organizationId,
        deletedAt: null,
        status: { in: ['UPCOMING', 'ACTIVE'] },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, courseId: true, capacity: true, _count: { select: { enrollments: true } } },
    }),
    db.enrollment.findMany({
      where: { organizationId: tenant.organizationId, source: { in: ['ADMIN_SINGLE', 'ADMIN_BULK'] } },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        product: { select: { title: true } },
        batch: { select: { name: true } },
        orderItemId: true,
      },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Enrol a learner"
        description="For counter payments, scholarships and anything the online checkout could not finish. Every manual enrolment is signed by whoever made it."
        action={
          <Link href="/admin/payments" className="t-small faint hover:underline">
            Payments →
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <EnrolForm
            products={products.map((p) => ({
              id: p.id,
              title: p.title,
              courseId: p.course?.id ?? '',
              plans: p.pricingPlans.map((pl) => ({
                id: pl.id,
                name: pl.name,
                price: pl.pricePaise === 0 ? 'Free' : formatMoney(pl.pricePaise, pl.currency),
                validityDays: pl.validityDays,
              })),
            }))}
            learners={learners}
            batches={batches.map((b) => ({
              id: b.id,
              name: b.name,
              courseId: b.courseId,
              seatsLeft: b.capacity ? b.capacity - b._count.enrollments : null,
            }))}
          />
        </Card>

        <div>
          <h2 className="t-heading mb-3">Recently enrolled by hand</h2>
          {recent.length === 0 ? (
            <EmptyState
              title="None yet"
              hint="Manual enrolments are listed here with who did them, so the trail is visible without opening a log."
            />
          ) : (
            <Table head={['Learner', 'Course', 'Batch', 'Paid', 'When']}>
              {recent.map((e) => (
                <Row key={e.id}>
                  <Cell>
                    <span className="text-sm font-medium">{e.user.name}</span>
                    <span className="t-small faint block">{e.user.email ?? '—'}</span>
                  </Cell>
                  <Cell className="t-small">{e.product.title}</Cell>
                  <Cell className="t-small faint">{e.batch?.name ?? '—'}</Cell>
                  <Cell>
                    {e.orderItemId ? <Badge tone="ok">recorded</Badge> : <Badge tone="neutral">free</Badge>}
                  </Cell>
                  <Cell className="t-small faint">
                    {e.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
