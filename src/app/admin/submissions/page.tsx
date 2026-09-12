import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The marking queue.
 *
 * The audit found Edmingle's submissions sitting unevaluated, which is the
 * quietest way an academy lets its learners down: the work was done and nobody
 * read it. Oldest first, with the wait in days, so the backlog is impossible to
 * look at and feel fine about.
 */
export default async function SubmissionsPage() {
  const tenant = await requireTenant();
  await requireStaff('submission.view_submissions', 'view');

  const submissions = await db.submission.findMany({
    where: {
      attempt: { assessment: { organizationId: tenant.organizationId } },
    },
    orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }],
    take: 100,
    select: {
      id: true,
      status: true,
      submittedAt: true,
      score: true,
      user: { select: { name: true, email: true } },
      attempt: {
        select: {
          id: true,
          attemptNo: true,
          scorePercent: true,
          assessment: { select: { id: true, title: true } },
        },
      },
    },
  });

  const waiting = submissions.filter((s) => s.status === 'NOT_EVALUATED');

  // The same queue by paper, for marking a class together.
  const byPaper = new Map<string, { id: string; title: string; waiting: number; drafted: number }>();
  for (const s of submissions) {
    if (s.status !== 'NOT_EVALUATED' && s.status !== 'AI_DRAFTED') continue;
    const id = s.attempt.assessment.id;
    const row = byPaper.get(id) ?? { id, title: s.attempt.assessment.title, waiting: 0, drafted: 0 };
    if (s.status === 'NOT_EVALUATED') row.waiting += 1;
    else row.drafted += 1;
    byPaper.set(id, row);
  }
  const papers = [...byPaper.values()].sort((a, b) => b.waiting + b.drafted - (a.waiting + a.drafted));
  const homework = await db.assignmentSubmission.count({
    where: { organizationId: tenant.organizationId, status: 'SUBMITTED' },
  });

  return (
    <div>
      <PageHeader
        title="Marking"
        description="Written answers waiting for a trainer. Oldest first, because the one that has waited longest is the one that matters."
      />

      {homework > 0 && (
        <p className="t-small mb-4 rounded-[var(--radius-sm)] border border-dashed p-3">
          {homework} homework hand-in{homework === 1 ? '' : 's'} waiting too, under{' '}
          <Link href="/admin/assignments" className="font-medium hover:underline">
            Assignments
          </Link>
          .
        </p>
      )}

      {waiting.length > 0 && (
        <p className="t-small mb-4 rounded-[var(--radius-sm)] border border-dashed p-3 text-[var(--warn)]">
          {waiting.length} paper{waiting.length === 1 ? '' : 's'} waiting. The oldest has been
          sitting {days(waiting[0].submittedAt)} day{days(waiting[0].submittedAt) === 1 ? '' : 's'}.
        </p>
      )}

      {papers.length > 0 && (
        <div className="mb-6 rounded-[var(--radius)] border bg-[var(--surface)] p-4">
          <p className="t-small font-medium">Mark a whole class together</p>
          <p className="t-small faint mt-0.5">Every waiting paper for one assessment on a single screen, read question by question, released in one press.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {papers.map((p) => (
              <li key={p.id}>
                <Link href={`/admin/submissions/bulk/${p.id}`} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm hover:bg-[var(--surface-2)]">
                  {p.title}
                  <span className="tabular-nums">
                    {p.waiting > 0 && <Badge tone="warn">{p.waiting}</Badge>}
                    {p.drafted > 0 && <Badge tone="brand">{p.drafted} AI</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {submissions.length === 0 ? (
        <EmptyState
          title="Nothing to mark"
          hint="Papers with written answers land here the moment they are submitted."
        />
      ) : (
        <Table head={['Learner', 'Assessment', 'Submitted', 'Waiting', 'Status', '']}>
          {submissions.map((s) => (
            <Row key={s.id}>
              <Cell>
                <span className="font-medium">{s.user.name}</span>
                <span className="t-small faint block">{s.user.email ?? '—'}</span>
              </Cell>
              <Cell>
                <span className="text-sm">{s.attempt.assessment.title}</span>
                <span className="t-small faint block">Attempt {s.attempt.attemptNo}</span>
              </Cell>
              <Cell className="t-small faint">
                {s.submittedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </Cell>
              <Cell className="tabular-nums">
                {s.status === 'NOT_EVALUATED' ? (
                  <span
                    style={{
                      color: days(s.submittedAt) > 3 ? 'var(--bad)' : 'var(--ink-2)',
                    }}
                  >
                    {days(s.submittedAt)}d
                  </span>
                ) : (
                  <span className="faint">—</span>
                )}
              </Cell>
              <Cell>
                {s.status === 'NOT_EVALUATED' ? (
                  <Badge tone="warn">waiting</Badge>
                ) : (
                  <>
                    {s.status === 'AI_DRAFTED' ? <Badge tone="brand">AI marked</Badge> : <Badge tone="ok">marked</Badge>}
                    {s.attempt.scorePercent != null && (
                      <span className="t-small faint ml-2 tabular-nums">
                        {s.attempt.scorePercent}%
                      </span>
                    )}
                  </>
                )}
              </Cell>
              <Cell>
                <Link
                  href={`/admin/submissions/${s.attempt.id}`}
                  className="t-small font-medium underline"
                >
                  {s.status === 'NOT_EVALUATED' ? 'Mark' : s.status === 'AI_DRAFTED' ? 'Check' : 'Review'}
                </Link>
              </Cell>
            </Row>
          ))}
        </Table>
      )}
    </div>
  );
}

function days(from: Date): number {
  return Math.max(0, Math.floor((Date.now() - from.getTime()) / 864e5));
}
