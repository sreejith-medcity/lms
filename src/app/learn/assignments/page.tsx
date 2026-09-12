import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatDateTime } from '@/lib/clock';
import { assignmentsWhereFor, learnerEnrolments } from '@/lib/assignment-access';
import { dueLabel, learnerStanding, latestOf, trimNumber, type LearnerStanding } from '@/lib/assignment-rules';
import { Badge, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Assignments' };

/**
 * Every piece of homework the learner has, the ones needing them first.
 *
 * Order: waiting on the learner (not started, or returned), soonest due
 * first; then handed in and waiting for a mark; then marked. A list that
 * put the finished work on top would be a list nobody scrolled.
 */
export default async function AssignmentsPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const tz = tenant.timezone;

  const enrolments = await learnerEnrolments(tenant.organizationId, user.id);
  const clauses = assignmentsWhereFor(enrolments);

  const assignments = clauses.length
    ? await db.assignment.findMany({
        where: { organizationId: tenant.organizationId, deletedAt: null, status: 'PUBLISHED', OR: clauses },
        select: {
          id: true,
          title: true,
          dueAt: true,
          maxMarks: true,
          status: true,
          acceptLate: true,
          allowResubmit: true,
          requireText: true,
          requireFile: true,
          course: { select: { product: { select: { title: true } } } },
          submissions: { where: { userId: user.id }, select: { attemptNo: true, status: true, marks: true } },
        },
      })
    : [];

  const rows = assignments.map((a) => ({ ...a, standing: learnerStanding(a, a.submissions) }));
  const rank: Record<LearnerStanding, number> = { RETURNED: 0, NOT_STARTED: 1, WAITING: 2, GRADED: 3, CLOSED: 4 };
  rows.sort((x, y) => rank[x.standing] - rank[y.standing] || (x.dueAt?.getTime() ?? Infinity) - (y.dueAt?.getTime() ?? Infinity));

  const todo = rows.filter((r) => r.standing === 'NOT_STARTED' || r.standing === 'RETURNED').length;

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Assignments</h1>
        <p className="t-small faint mt-1">
          {rows.length === 0 ? 'Homework your trainers set will appear here.' : todo === 0 ? 'Nothing waiting on you.' : `${todo} waiting on you.`}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No homework yet" hint="When a trainer sets an assignment for your course or batch, it lands here and you get a message." />
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => {
            const latest = latestOf(a.submissions);
            return (
              <li key={a.id}>
                <Link
                  href={`/learn/assignments/${a.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-[var(--surface)] px-4 py-3 shadow-sm transition hover:bg-[var(--surface-2)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.title}</span>
                    <span className="t-small faint block truncate">
                      {a.course.product.title}
                      {a.dueAt ? ` · due ${formatDateTime(a.dueAt, tz)}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {a.standing === 'GRADED' && latest?.marks !== null && latest?.marks !== undefined && (
                      <span className="t-small tabular-nums">
                        {trimNumber(latest.marks)} / {trimNumber(a.maxMarks)}
                      </span>
                    )}
                    <Standing standing={a.standing} dueAt={a.dueAt} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Standing({ standing, dueAt }: { standing: LearnerStanding; dueAt: Date | null }) {
  switch (standing) {
    case 'RETURNED':
      return <Badge tone="warn">returned, try again</Badge>;
    case 'NOT_STARTED':
      return dueAt && dueAt < new Date() ? <Badge tone="bad">{dueLabel(dueAt)}</Badge> : <Badge tone="brand">{dueLabel(dueAt)}</Badge>;
    case 'WAITING':
      return <Badge tone="neutral">handed in</Badge>;
    case 'GRADED':
      return <Badge tone="ok">marked</Badge>;
    default:
      return <Badge tone="neutral">closed</Badge>;
  }
}
