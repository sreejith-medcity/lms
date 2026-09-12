import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatDateTime } from '@/lib/clock';
import { formatBytes } from '@/lib/storage';
import { enrolmentFor } from '@/lib/assignment-access';
import { dueLabel, handInDecision, latestOf, marksPercent, trimNumber } from '@/lib/assignment-rules';
import { Badge, Card } from '@/components/ui';
import { HandInForm } from './hand-in-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Assignment' };

/**
 * The brief, what the learner has handed in, what came back, and the
 * form to hand in, in that order. The form is only drawn when the rules
 * allow a hand-in; otherwise the page says why in one line, the same
 * line the action would refuse with.
 */
export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const tz = tenant.timezone;

  const a = await db.assignment.findFirst({
    where: { id, organizationId: tenant.organizationId, deletedAt: null, status: { in: ['PUBLISHED', 'UNPUBLISHED'] } },
    select: {
      id: true,
      title: true,
      instructions: true,
      maxMarks: true,
      dueAt: true,
      status: true,
      courseId: true,
      batchId: true,
      acceptLate: true,
      allowResubmit: true,
      requireText: true,
      requireFile: true,
      course: { select: { productId: true, product: { select: { title: true } } } },
      attachments: { orderBy: { sortOrder: 'asc' }, select: { assetId: true, asset: { select: { fileName: true, sizeBytes: true } } } },
      submissions: {
        where: { userId: user.id },
        orderBy: { attemptNo: 'desc' },
        select: {
          id: true,
          attemptNo: true,
          status: true,
          text: true,
          submittedAt: true,
          isLate: true,
          marks: true,
          feedback: true,
          gradedAt: true,
          files: { orderBy: { sortOrder: 'asc' }, select: { assetId: true, asset: { select: { fileName: true, sizeBytes: true } } } },
        },
      },
    },
  });
  if (!a) notFound();
  const mine = await enrolmentFor(tenant.organizationId, user.id, a);
  // A learner who once handed in keeps their own work readable after leaving the batch.
  if (!mine && a.submissions.length === 0) notFound();

  const decision = mine ? handInDecision(a, a.submissions) : { allowed: false as const, reason: 'You are no longer enrolled for this assignment.' };
  const latest = latestOf(a.submissions);

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <Link href="/learn/assignments" className="t-small faint hover:underline">
        Assignments
      </Link>
      <h1 className="mt-2 text-xl font-semibold">{a.title}</h1>
      <p className="t-small faint mt-1">
        {a.course.product.title}
        {a.dueAt ? (
          <>
            {' · due '}
            {formatDateTime(a.dueAt, tz)} <span className={a.dueAt < new Date() ? 'text-[var(--bad)]' : ''}>({dueLabel(a.dueAt)})</span>
          </>
        ) : (
          ' · no due date'
        )}
        {' · out of '}
        {trimNumber(a.maxMarks)}
      </p>

      <Card className="mt-5">
        {a.instructions ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{a.instructions}</div>
        ) : (
          <p className="t-small faint">No written brief. See the files below.</p>
        )}
        {a.attachments.length > 0 && (
          <ul className="mt-4 divide-y rounded-[var(--radius-sm)] border">
            {a.attachments.map((f) => (
              <li key={f.assetId} className="flex items-center justify-between gap-3 px-3 py-2">
                <a href={`/api/assets/${f.assetId}`} target="_blank" rel="noreferrer" className="t-small min-w-0 truncate hover:underline">
                  {f.asset.fileName}
                </a>
                <span className="t-micro faint shrink-0">{formatBytes(f.asset.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="t-small faint mt-4">
          {[a.requireText ? 'A written answer is required.' : null, a.requireFile ? 'A file is required.' : null, a.acceptLate ? 'Late work is accepted and marked late.' : 'Nothing is taken after the due date.', a.allowResubmit ? 'You may hand in again after it is marked.' : 'One hand-in only.']
            .filter(Boolean)
            .join(' ')}
        </p>
      </Card>

      {latest?.status === 'GRADED' && (
        <Card className="mt-5 border-[var(--ok)]/40">
          <p className="font-medium">
            Marked {trimNumber(latest.marks ?? 0)} out of {trimNumber(a.maxMarks)}
            <span className="t-small faint"> ({marksPercent(latest.marks ?? 0, a.maxMarks)}%)</span>
          </p>
          {latest.gradedAt && <p className="t-micro faint mt-0.5">{formatDateTime(latest.gradedAt, tz)}</p>}
          {latest.feedback ? <p className="t-small mt-3 whitespace-pre-wrap">{latest.feedback}</p> : <p className="t-small faint mt-3">No written feedback.</p>}
        </Card>
      )}
      {latest?.status === 'RETURNED' && (
        <Card className="mt-5 border-[var(--warn)]/40">
          <p className="font-medium">Returned for another go</p>
          {latest.gradedAt && <p className="t-micro faint mt-0.5">{formatDateTime(latest.gradedAt, tz)}</p>}
          <p className="t-small mt-3 whitespace-pre-wrap">{latest.feedback}</p>
        </Card>
      )}
      {latest?.status === 'SUBMITTED' && (
        <p className="t-small mt-5 rounded-[var(--radius-sm)] border border-dashed p-3">
          Handed in {formatDateTime(latest.submittedAt, tz)}
          {latest.isLate ? ', after the due date' : ''}. Waiting for your trainer.
        </p>
      )}

      {decision.allowed ? (
        <div className="mt-6">
          <h2 className="t-heading mb-3">{decision.again ? 'Hand in again' : 'Hand in'}</h2>
          {decision.late && <p className="t-small mb-3 text-[var(--warn)]">The due date has passed. It will be taken and marked late.</p>}
          <HandInForm assignmentId={a.id} requireText={a.requireText} requireFile={a.requireFile} again={decision.again} />
        </div>
      ) : (
        !latest || latest.status !== 'GRADED' ? <p className="t-small faint mt-6">{decision.reason}</p> : null
      )}

      {a.submissions.length > 0 && (
        <section className="mt-8">
          <h2 className="t-heading mb-3">What you handed in</h2>
          <ul className="space-y-3">
            {a.submissions.map((s) => (
              <li key={s.id} className="rounded-[var(--radius)] border bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="t-small font-medium">
                    {a.submissions.length > 1 ? `Attempt ${s.attemptNo}` : 'Your hand-in'}
                    {s.isLate && (
                      <>
                        {' '}
                        <Badge tone="warn">late</Badge>
                      </>
                    )}
                  </span>
                  <span className="t-micro faint">{formatDateTime(s.submittedAt, tz)}</span>
                </div>
                {s.text && <div className="t-small mt-2 whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3">{s.text}</div>}
                {s.files.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {s.files.map((f) => (
                      <li key={f.assetId} className="t-small">
                        <a href={`/api/assets/${f.assetId}`} target="_blank" rel="noreferrer" className="hover:underline">
                          {f.asset.fileName}
                        </a>{' '}
                        <span className="t-micro faint">{formatBytes(f.asset.sizeBytes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {s.id !== latest?.id && s.status !== 'SUBMITTED' && (
                  <p className="t-small faint mt-2">
                    {s.status === 'GRADED' ? `Marked ${trimNumber(s.marks ?? 0)} / ${trimNumber(a.maxMarks)}` : 'Returned'}
                    {s.feedback ? ` · ${s.feedback}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
