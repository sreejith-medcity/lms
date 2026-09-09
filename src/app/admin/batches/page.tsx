import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { Badge, Cell, EmptyState, PageHeader, ProgressRing, Row, Table } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function BatchesPage() {
  const tenant = await requireTenant();

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

      {batches.length === 0 ? (
        <EmptyState title="No batches yet" hint="Batches are created against a course." />
      ) : (
        <Table head={['Batch', 'Course', 'Status', 'Learners', 'Sessions', 'Progress']}>
          {batches.map((b) => (
            <Row key={b.id}>
              <Cell>
                <span className="font-medium">{b.name}</span>
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
                <Badge tone={b.status === 'ACTIVE' ? 'ok' : b.status === 'COMPLETED' ? 'neutral' : 'warn'}>
                  {b.status.toLowerCase()}
                </Badge>
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
  );
}
