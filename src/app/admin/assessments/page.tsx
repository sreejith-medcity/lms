import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { NewAssessmentForm } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function AssessmentsPage() {
  const tenant = await requireTenant();
  await requireStaff('courses.assessments', 'view');

  const assessments = await db.assessment.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      kind: true,
      durationMinutes: true,
      passPercent: true,
      maxAttempts: true,
      _count: { select: { questions: true, attempts: true, courses: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="Tests, mock exams and assignments, built from the question bank and attached to the courses that use them."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          {assessments.length === 0 ? (
            <EmptyState
              title="No assessments yet"
              hint="Write questions into a bank first, then build an assessment from them."
            />
          ) : (
            <Table head={['Assessment', 'Questions', 'Attached to', 'Attempts', 'Rules']}>
              {assessments.map((a) => (
                <Row key={a.id}>
                  <Cell>
                    <Link href={`/admin/assessments/${a.id}`} className="font-medium hover:underline">
                      {a.title}
                    </Link>
                    <span className="t-small faint block">{a.kind.toLowerCase().replace('_', ' ')}</span>
                  </Cell>
                  <Cell className="tabular-nums">
                    {a._count.questions === 0 ? (
                      <Badge tone="warn">empty</Badge>
                    ) : (
                      a._count.questions
                    )}
                  </Cell>
                  <Cell className="tabular-nums">
                    {a._count.courses === 0 ? (
                      <Badge tone="warn">no course</Badge>
                    ) : (
                      `${a._count.courses} course${a._count.courses === 1 ? '' : 's'}`
                    )}
                  </Cell>
                  <Cell className="tabular-nums">{a._count.attempts}</Cell>
                  <Cell className="t-small faint">
                    {a.durationMinutes ? `${a.durationMinutes} min` : 'untimed'} · pass{' '}
                    {a.passPercent}% · {a.maxAttempts} attempt{a.maxAttempts === 1 ? '' : 's'}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </div>

        <Card>
          <h2 className="t-heading">New assessment</h2>
          <p className="t-small muted mt-1">
            Settings can be changed later. Questions come from the bank once it exists.
          </p>
          <div className="mt-5">
            <NewAssessmentForm />
          </div>
        </Card>
      </div>
    </div>
  );
}
