import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Badge, Card, EmptyState, Section, Table, Row, Cell } from '@/components/ui';
import { EXAM_FORMATS } from '@/lib/exams/registry';
import { setCounts } from '@/lib/exams/content';
import { TEST_PERMS } from '@/lib/exams/perms';
import { AssignmentForm, EndAssignmentButton } from '../editors';

export const dynamic = 'force-dynamic';

export default async function Assignments() {
  const tenant = await requireTenant();
  const user = await requireStaff(TEST_PERMS.assign, 'view');
  const mayEdit = can(user.permissions, TEST_PERMS.assign, 'edit');
  const [rows, batches, counts] = await Promise.all([
    db.examAssignment.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.batch.findMany({ where: { organizationId: tenant.organizationId, status: { in: ['UPCOMING', 'ACTIVE'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    setCounts(tenant.organizationId),
  ]);
  const batchNames = Object.fromEntries(
    (await db.batch.findMany({ where: { organizationId: tenant.organizationId, id: { in: rows.map((r) => r.batchId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]),
  );
  const sat = rows.length
    ? await db.examSitting.groupBy({ by: ['assignmentId', 'status'], where: { organizationId: tenant.organizationId, assignmentId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
    : [];
  const satOf = (id: string) => sat.filter((x) => x.assignmentId === id && x.status !== 'VOID' && x.status !== 'IN_PROGRESS').reduce((a, x) => a + x._count._all, 0);
  const formats = EXAM_FORMATS.filter((f) => (counts[f.code] ?? 0) > 0).map((f) => ({ code: f.code, name: f.name, sections: f.sections.map((s) => ({ id: s.id, title: s.title })) }));
  const nameOf = (code: string) => EXAM_FORMATS.find((f) => f.code === code)?.name ?? code;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Section title="Papers set">
        {rows.length === 0 ? (
          <EmptyState title="None set yet" hint="Set a paper for a batch and every learner in it sees it on their Mock tests page, with the same code, free." />
        ) : (
          <Table head={['Paper', 'Batch', 'Handed in', '']}>
            {rows.map((a) => (
              <Row key={a.id}>
                <Cell>
                  <span className="font-medium">{a.title || nameOf(a.formatCode)}</span> {!a.active && <Badge>closed</Badge>}
                  <p className="t-small faint">
                    {nameOf(a.formatCode)} · code {a.drawCode}
                    {a.dueAt ? ` · due ${a.dueAt.toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: tenant.timezone })}` : ''}
                  </p>
                </Cell>
                <Cell>{(a.batchId && batchNames[a.batchId]) || '–'}</Cell>
                <Cell className="tabular-nums">{satOf(a.id)}</Cell>
                <Cell className="text-right">{mayEdit && a.active && <EndAssignmentButton id={a.id} />}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>
      {mayEdit && (
        <Section title="Set a paper">
          <Card>
            <AssignmentForm batches={batches} formats={formats} />
          </Card>
        </Section>
      )}
    </div>
  );
}
