import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatDateTime } from '@/lib/clock';
import { dueLabel, handInTally } from '@/lib/assignment-rules';
import { Badge, Cell, EmptyState, LinkButton, PageHeader, Row, Table } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Homework, every piece of it, with who has handed in and who is waiting
 * on a trainer. The "to mark" column is the point of the page: an
 * assignment whose count there is climbing is one the trainer has
 * stopped opening.
 */
export default async function AssignmentsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('courses.assessments', 'view');
  const canEdit = me.permissions['courses.assessments']?.edit ?? false;

  const assignments = await db.assignment.findMany({
    where: { organizationId: tenant.organizationId, deletedAt: null },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      title: true,
      status: true,
      dueAt: true,
      batchId: true,
      courseId: true,
      course: { select: { product: { select: { title: true } } } },
      batch: { select: { name: true, _count: { select: { enrollments: { where: { status: { in: ['ENROLLED', 'ON_LEAVE'] } } } } } } },
      submissions: { select: { userId: true, attemptNo: true, status: true } },
    },
  });

  // For course-wide homework the class is everyone enrolled in the course.
  const courseWide = assignments.filter((a) => !a.batchId);
  const enrolledByCourse = new Map<string, number>();
  if (courseWide.length) {
    const rows = await db.enrollment.groupBy({
      by: ['productId'],
      where: { organizationId: tenant.organizationId, status: { in: ['ENROLLED', 'ON_LEAVE'] } },
      _count: { userId: true },
    });
    const courses = await db.course.findMany({
      where: { organizationId: tenant.organizationId },
      select: { id: true, productId: true },
    });
    for (const c of courses) enrolledByCourse.set(c.id, rows.find((r) => r.productId === c.productId)?._count.userId ?? 0);
  }

  const totalToMark = assignments.reduce((n, a) => n + handInTally(a.submissions, 0).toMark, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assignments"
        description="Homework with a due date. Learners hand in text and files; a trainer marks it with feedback. Timed papers with an answer key live under Assessments."
        action={canEdit ? <LinkButton href="/admin/assignments/new">Set homework</LinkButton> : undefined}
      />

      {totalToMark > 0 && (
        <p className="t-small rounded-[var(--radius-sm)] border border-dashed p-3 text-[var(--warn)]">
          {totalToMark} hand-in{totalToMark === 1 ? '' : 's'} waiting to be marked.
        </p>
      )}

      {assignments.length === 0 ? (
        <EmptyState
          title="No homework set yet"
          hint="Set the first piece: a title, the brief, a due date, and whether files or a written answer are needed."
          action={canEdit ? <LinkButton href="/admin/assignments/new">Set homework</LinkButton> : undefined}
        />
      ) : (
        <Table head={['Assignment', 'For', 'Due', 'Handed in', 'To mark', 'Status']}>
          {assignments.map((a) => {
            const enrolled = a.batch ? a.batch._count.enrollments : (enrolledByCourse.get(a.courseId) ?? 0);
            const tally = handInTally(a.submissions, enrolled);
            return (
              <Row key={a.id}>
                <Cell>
                  <Link href={`/admin/assignments/${a.id}`} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                </Cell>
                <Cell className="t-small muted">
                  {a.course.product.title}
                  {a.batch ? <span className="faint"> · {a.batch.name}</span> : <span className="faint"> · every batch</span>}
                </Cell>
                <Cell className="t-small">
                  {a.dueAt ? (
                    <>
                      <span className="block">{formatDateTime(a.dueAt, tenant.timezone)}</span>
                      <span className="t-micro faint">{dueLabel(a.dueAt)}</span>
                    </>
                  ) : (
                    <span className="faint">No due date</span>
                  )}
                </Cell>
                <Cell className="t-small tabular-nums">{tally.handedIn}</Cell>
                <Cell className="t-small tabular-nums">
                  {tally.toMark > 0 ? <Badge tone="warn">{tally.toMark}</Badge> : <span className="faint">0</span>}
                </Cell>
                <Cell>
                  {a.status === 'PUBLISHED' ? <Badge tone="ok">open</Badge> : a.status === 'DRAFT' ? <Badge tone="neutral">draft</Badge> : <Badge tone="neutral">{a.status.toLowerCase()}</Badge>}
                </Cell>
              </Row>
            );
          })}
        </Table>
      )}
    </div>
  );
}
