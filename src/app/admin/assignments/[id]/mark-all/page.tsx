import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatDateTime } from '@/lib/clock';
import { formatBytes } from '@/lib/storage';
import { EmptyState, PageHeader } from '@/components/ui';
import { MarkAllForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Every hand-in waiting on one assignment, on one screen, with a mark and
 * a line of feedback each and one press to mark them all. The latest
 * attempt per learner only; earlier ones are history.
 */
export default async function MarkAllPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('submission.view_submissions', 'view');
  const canMark = me.permissions['submission.evaluate_submissions']?.edit ?? false;
  const tz = tenant.timezone;

  const a = await db.assignment.findFirst({
    where: { id, organizationId: tenant.organizationId, deletedAt: null },
    select: {
      id: true,
      title: true,
      maxMarks: true,
      course: { select: { product: { select: { title: true } } } },
      submissions: {
        where: { status: 'SUBMITTED' },
        orderBy: [{ submittedAt: 'asc' }],
        select: {
          id: true,
          userId: true,
          attemptNo: true,
          text: true,
          submittedAt: true,
          isLate: true,
          user: { select: { name: true } },
          files: { orderBy: { sortOrder: 'asc' }, select: { assetId: true, asset: { select: { fileName: true, sizeBytes: true } } } },
        },
      },
    },
  });
  if (!a) notFound();

  const latest = new Map<string, (typeof a.submissions)[number]>();
  for (const s of a.submissions) {
    const cur = latest.get(s.userId);
    if (!cur || s.attemptNo > cur.attemptNo) latest.set(s.userId, s);
  }
  const rows = [...latest.values()].map((s) => ({
    id: s.id,
    learner: s.user.name,
    attemptNo: s.attemptNo,
    text: s.text ?? '',
    when: formatDateTime(s.submittedAt, tz),
    late: s.isLate,
    files: s.files.map((f) => ({ assetId: f.assetId, name: f.asset.fileName, size: formatBytes(f.asset.sizeBytes) })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Mark all: ${a.title}`}
        description={`${a.course.product.title} · out of ${a.maxMarks} · ${rows.length} waiting`}
        action={
          <Link href={`/admin/assignments/${a.id}`} className="t-small faint hover:underline">
            Back to the class
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="Nothing waiting" hint="Every hand-in on this assignment has been marked or returned." />
      ) : (
        <MarkAllForm assignmentId={a.id} maxMarks={a.maxMarks} rows={rows} canMark={canMark} />
      )}
    </div>
  );
}
