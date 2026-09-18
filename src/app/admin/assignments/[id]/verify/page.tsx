import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { canSeeBatch, enrollmentWhere, staffScope } from '@/lib/scope';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { VerifyList } from './list';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Homework verification: a status per learner without a mark. Who has not
 * handed in, who is waiting to be looked at, who is complete, incomplete
 * or asked to hand in again. The latest hand-in per learner is the one
 * judged.
 */
export default async function VerifyHomework({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('courses.assessments', 'view');
  const scope = await staffScope(me);
  const canEdit = me.permissions['courses.assessments']?.edit ?? false;
  const tz = tenant.timezone;

  const assignment = await db.assignment.findFirst({
    where: { id, organizationId: tenant.organizationId, deletedAt: null },
    select: { id: true, title: true, dueAt: true, courseId: true, batchId: true, batch: { select: { id: true, name: true, branchId: true } }, course: { select: { product: { select: { title: true } } } } },
  });
  if (!assignment) notFound();
  if (assignment.batch && !canSeeBatch(scope, assignment.batch)) notFound();

  const roster = await db.enrollment.findMany({
    where: {
      organizationId: tenant.organizationId,
      status: { in: ['ENROLLED', 'COMPLETED', 'ON_LEAVE'] },
      ...(assignment.batchId ? { batchId: assignment.batchId } : { product: { course: { id: assignment.courseId } } }),
      ...enrollmentWhere(scope),
    },
    orderBy: { user: { name: 'asc' } },
    select: { user: { select: { id: true, name: true } } },
  });
  const learnerIds = Array.from(new Set(roster.map((r) => r.user.id)));
  const subs = await db.assignmentSubmission.findMany({
    where: { organizationId: tenant.organizationId, assignmentId: assignment.id, userId: { in: learnerIds } },
    orderBy: { attemptNo: 'desc' },
    select: { id: true, userId: true, attemptNo: true, status: true, submittedAt: true, isLate: true, verification: true, verifiedAt: true, feedback: true, marks: true },
  });
  const latest = new Map<string, (typeof subs)[number]>();
  for (const s of subs) if (!latest.has(s.userId)) latest.set(s.userId, s);

  const seen = new Set<string>();
  const rows = roster
    .filter((r) => (seen.has(r.user.id) ? false : (seen.add(r.user.id), true)))
    .map((r) => {
      const s = latest.get(r.user.id);
      return {
        userId: r.user.id,
        name: r.user.name,
        submissionId: s?.id ?? null,
        handedIn: s ? formatDayLabel(dayKey(s.submittedAt, tz), tz) : null,
        late: s?.isLate ?? false,
        attempt: s?.attemptNo ?? 0,
        verification: s?.verification ?? null,
        status: s?.status ?? null,
        feedback: s?.feedback ?? '',
        marks: s?.marks ?? null,
      };
    });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link href={`/admin/assignments/${assignment.id}`} className="t-small faint hover:underline">
          {assignment.title}
        </Link>
        <h1 className="t-title mt-1">Verify homework</h1>
        <p className="t-small faint mt-1">
          {assignment.course.product.title}
          {assignment.batch ? ` · ${assignment.batch.name}` : ' · every batch'}
          {assignment.dueAt ? ` · due ${formatDayLabel(dayKey(assignment.dueAt, tz), tz)}` : ''}
        </p>
      </div>
      <VerifyList rows={rows} canEdit={canEdit} />
    </div>
  );
}
