import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatDateTime } from '@/lib/clock';
import { formatBytes } from '@/lib/storage';
import { marksPercent, trimNumber } from '@/lib/assignment-rules';
import { Avatar } from '@/components/avatar';
import { Badge, Card, PageHeader, Section } from '@/components/ui';
import { MarkForm } from './mark-form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * One learner's hand-in, with the mark form beside it.
 *
 * Earlier attempts and their feedback sit underneath, so a trainer marking
 * the second try can see what they asked for on the first without opening
 * another tab. Only the latest attempt takes a mark.
 */
export default async function HandInPage({ params }: { params: Promise<{ id: string; submissionId: string }> }) {
  const { id, submissionId } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('submission.view_submissions', 'view');
  const canMark = me.permissions['submission.evaluate_submissions']?.edit ?? false;
  const tz = tenant.timezone;

  const s = await db.assignmentSubmission.findFirst({
    where: { id: submissionId, assignmentId: id, organizationId: tenant.organizationId },
    select: {
      id: true,
      userId: true,
      attemptNo: true,
      status: true,
      text: true,
      submittedAt: true,
      isLate: true,
      marks: true,
      feedback: true,
      gradedAt: true,
      gradedById: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      files: { orderBy: { sortOrder: 'asc' }, select: { assetId: true, asset: { select: { fileName: true, sizeBytes: true, mimeType: true } } } },
      assignment: { select: { id: true, title: true, maxMarks: true, dueAt: true, course: { select: { product: { select: { title: true } } } } } },
    },
  });
  if (!s) notFound();

  const others = await db.assignmentSubmission.findMany({
    where: { organizationId: tenant.organizationId, assignmentId: id, userId: s.userId, id: { not: s.id } },
    orderBy: { attemptNo: 'desc' },
    select: { id: true, attemptNo: true, status: true, submittedAt: true, marks: true, feedback: true, isLate: true },
  });
  const newer = others.find((o) => o.attemptNo > s.attemptNo);

  const grader = s.gradedById
    ? await db.user.findFirst({ where: { organizationId: tenant.organizationId, id: s.gradedById }, select: { name: true } })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={s.assignment.title}
        description={s.assignment.course.product.title}
        action={
          <Link href={`/admin/assignments/${id}`} className="t-small faint hover:underline">
            Back to the class
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <div className="mb-4 flex items-center gap-3">
              <Avatar name={s.user.name} src={s.user.avatarUrl} size={40} />
              <div className="min-w-0">
                <Link href={`/admin/learners/${s.user.id}`} className="block truncate font-medium hover:underline">
                  {s.user.name}
                </Link>
                <p className="t-small muted">
                  Handed in {formatDateTime(s.submittedAt, tz)}
                  {s.attemptNo > 1 ? ` · attempt ${s.attemptNo}` : ''}
                  {s.isLate && (
                    <>
                      {' '}
                      <Badge tone="warn">late</Badge>
                    </>
                  )}
                </p>
              </div>
            </div>

            {s.text ? (
              <div className="whitespace-pre-wrap rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-4 text-sm leading-relaxed">{s.text}</div>
            ) : (
              <p className="t-small faint">No written answer; the work is in the files.</p>
            )}

            {s.files.length > 0 && (
              <ul className="mt-4 divide-y rounded-[var(--radius-sm)] border">
                {s.files.map((f) => (
                  <li key={f.assetId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <a href={`/api/assets/${f.assetId}`} target="_blank" rel="noreferrer" className="t-small min-w-0 truncate hover:underline">
                      {f.asset.fileName}
                    </a>
                    <span className="t-micro faint shrink-0">{formatBytes(f.asset.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {others.length > 0 && (
            <Section title="Other attempts">
              <ul className="space-y-2">
                {others.map((o) => (
                  <li key={o.id} className="rounded-[var(--radius-sm)] border bg-[var(--surface)] px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/admin/assignments/${id}/hand-ins/${o.id}`} className="t-small font-medium hover:underline">
                        Attempt {o.attemptNo}
                      </Link>
                      <span className="t-micro faint">{formatDateTime(o.submittedAt, tz)}</span>
                    </div>
                    <p className="t-small muted mt-1">
                      {o.status === 'GRADED' ? `${trimNumber(o.marks ?? 0)} / ${trimNumber(s.assignment.maxMarks)}` : o.status === 'RETURNED' ? 'Returned for another go' : 'Not marked'}
                      {o.feedback ? ` · ${o.feedback}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {s.status !== 'SUBMITTED' && (
            <Card>
              <p className="t-small font-medium">
                {s.status === 'GRADED' ? (
                  <>
                    Marked {trimNumber(s.marks ?? 0)} out of {trimNumber(s.assignment.maxMarks)} ({marksPercent(s.marks ?? 0, s.assignment.maxMarks)}%)
                  </>
                ) : (
                  'Returned for another go'
                )}
              </p>
              <p className="t-micro faint mt-1">
                {s.gradedAt ? formatDateTime(s.gradedAt, tz) : ''}
                {grader ? ` by ${grader.name}` : ''}
              </p>
              {s.feedback && <p className="t-small mt-3 whitespace-pre-wrap">{s.feedback}</p>}
            </Card>
          )}

          {newer ? (
            <p className="t-small rounded-[var(--radius-sm)] border border-dashed p-3">
              The learner has handed in again since.{' '}
              <Link href={`/admin/assignments/${id}/hand-ins/${newer.id}`} className="font-medium hover:underline">
                Mark attempt {newer.attemptNo}
              </Link>
              .
            </p>
          ) : canMark ? (
            <MarkForm
              submissionId={s.id}
              maxMarks={s.assignment.maxMarks}
              marks={s.marks}
              feedback={s.feedback ?? ''}
              alreadyMarked={s.status !== 'SUBMITTED'}
            />
          ) : (
            <p className="t-small faint">You can read this but not mark it.</p>
          )}
        </div>
      </div>
    </div>
  );
}
