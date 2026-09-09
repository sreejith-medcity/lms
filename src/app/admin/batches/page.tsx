import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, Cell, EmptyState, PageHeader, ProgressRing, Row, Table } from '@/components/ui';
import { NewBatchForm, BatchStatus } from './editors';

export const dynamic = 'force-dynamic';

export default async function BatchesPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('batches.batch_management', 'view');
  const canEdit = me.permissions['batches.batch_management']?.edit ?? false;

  const [courses, branches] = await Promise.all([
    db.course.findMany({
      where: { organizationId: tenant.organizationId },
      select: { id: true, product: { select: { title: true } } },
    }),
    db.branch.findMany({
      where: { organizationId: tenant.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const batches = await db.batch.findMany({
    where: { organizationId: tenant.organizationId, deletedAt: null },
    include: {
      course: { include: { product: { select: { title: true } } } },
      _count: { select: { enrollments: true, sessions: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div>
      <PageHeader
        title="Batches"
        description="A batch is a cohort running a course on a schedule, with its own learners and sessions."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
      {batches.length === 0 ? (
        <EmptyState title="No batches yet" hint="Create the first one beside." />
      ) : (
        <Table head={['Batch', 'Course', 'Status', 'Learners', 'Sessions', 'Progress']}>
          {batches.map((b) => (
            <Row key={b.id}>
              <Cell>
                <Link href={`/admin/batches/${b.id}`} className="font-medium hover:underline">
                  {b.name}
                </Link>
                {b.isDefault && (
                  <span className="ml-2">
                    <Badge>default</Badge>
                  </span>
                )}
                {b.startDate && (
                  <span className="t-small faint block">
                    {b.startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {b.endDate &&
                      ` to ${b.endDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  </span>
                )}
              </Cell>
              <Cell className="muted">{b.course.product.title}</Cell>
              <Cell>
                {canEdit ? (
                  <BatchStatus id={b.id} status={b.status} />
                ) : (
                  <Badge tone={b.status === 'ACTIVE' ? 'ok' : b.status === 'COMPLETED' ? 'neutral' : 'warn'}>
                    {b.status.toLowerCase()}
                  </Badge>
                )}
              </Cell>
              <Cell className="tabular-nums">{b._count.enrollments}</Cell>
              <Cell className="tabular-nums">{b._count.sessions}</Cell>
              <Cell>
                <ProgressRing value={b.progressPercent} size={34} />
              </Cell>
            </Row>
          ))}
        </Table>
      )}
      </div>

      {canEdit && (
        <Card>
          <h2 className="t-heading">New batch</h2>
          <p className="t-small muted mt-1">
            A batch is a cohort running one course on one schedule. Enrolment falls back to the
            default batch when nobody picks one, which is why there is only ever one per course.
          </p>
          <div className="mt-5">
            <NewBatchForm
              courses={courses.map((c) => ({ id: c.id, title: c.product.title }))}
              branches={branches}
            />
          </div>
        </Card>
      )}
      </div>
    </div>
  );
}
