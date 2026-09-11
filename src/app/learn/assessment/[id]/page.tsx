import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { Badge, Card, EmptyState, LinkButton } from '@/components/ui';
import { assessmentAccess } from '@/lib/assessment-access';
import { StartButton } from './start';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/** The page before the paper: what it is, what the rules are, what you scored before. */
export default async function AssessmentIntro({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const assessment = await db.assessment.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      id: true,
      title: true,
      kind: true,
      instructions: true,
      durationMinutes: true,
      maxAttempts: true,
      passPercent: true,
      opensAt: true,
      closesAt: true,
      questions: { select: { marks: true, question: { select: { marks: true, type: true } } } },
      courses: {
        select: { course: { select: { product: { select: { id: true, title: true } } } } },
      },
    },
  });
  if (!assessment) notFound();

  const attempts = await db.attempt.findMany({
    where: { assessmentId: id, userId: user.id },
    orderBy: { attemptNo: 'desc' },
    select: {
      id: true,
      attemptNo: true,
      status: true,
      scorePercent: true,
      passed: true,
      submittedAt: true,
    },
  });

  // What this learner in particular may do here: their course, anything the
  // academy granted them, and any set they hold an allowance over.
  const access = await assessmentAccess({
    organizationId: tenant.organizationId,
    userId: user.id,
    assessmentId: assessment.id,
    isStaff: user.kind === 'STAFF',
  });

  const total = assessment.questions.reduce((n, q) => n + (q.marks ?? q.question.marks), 0);
  const written = assessment.questions.filter(
    (q) => q.question.type === 'SHORT_ANSWER' || q.question.type === 'LONG_ANSWER',
  ).length;
  const used = attempts.filter((a) => a.status !== 'VOID').length;
  const inProgress = attempts.find((a) => a.status === 'IN_PROGRESS');
  const product = assessment.courses[0]?.course.product;

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      {product && (
        <Link href={`/learn/${product.id}`} className="t-small faint hover:underline">
          {product.title}
        </Link>
      )}
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{assessment.title}</h1>
      <p className="t-small faint mt-1">{assessment.kind.toLowerCase().replace('_', ' ')}</p>

      <Card className="mt-6">
        <dl className="grid gap-4 sm:grid-cols-4">
          <Fact label="Questions" value={String(assessment.questions.length)} />
          <Fact label="Marks" value={String(total)} />
          <Fact
            label="Time"
            value={assessment.durationMinutes ? `${assessment.durationMinutes} min` : 'Untimed'}
          />
          <Fact label="Pass mark" value={`${assessment.passPercent}%`} />
        </dl>

        {assessment.instructions && (
          <p className="muted mt-5 whitespace-pre-wrap border-t pt-5 text-sm leading-relaxed">
            {assessment.instructions}
          </p>
        )}

        <ul className="t-small muted mt-5 space-y-1.5 border-t pt-5">
          <li>
            You have {access.allowance.allowed} attempt
            {access.allowance.allowed === 1 ? '' : 's'}, and have used {access.allowance.used}.
            {access.allowance.allowed > assessment.maxAttempts &&
              ` The academy has added ${access.allowance.allowed - assessment.maxAttempts} for you.`}
          </li>
          {access.via === 'POOL' && access.pool && (
            <li>
              This one counts towards {access.pool.name}: {access.pool.state.used} of{' '}
              {access.pool.state.allowed} taken.
            </li>
          )}
          {assessment.durationMinutes ? (
            <li>
              The clock starts when you begin and runs on our server, so closing the page does not
              pause it. Your answers save as you go.
            </li>
          ) : (
            <li>There is no time limit. Your answers save as you go.</li>
          )}
          {written > 0 && (
            <li>
              {written} question{written === 1 ? '' : 's'} {written === 1 ? 'is' : 'are'} written
              and marked by a trainer, so your final score arrives after they have read it.
            </li>
          )}
        </ul>

        <div className="mt-6">
          {assessment.questions.length === 0 ? (
            <p className="t-small faint">This assessment has no questions yet.</p>
          ) : inProgress ? (
            <LinkButton href={`/learn/attempt/${inProgress.id}`} size="lg">
              Resume attempt {inProgress.attemptNo}
            </LinkButton>
          ) : !access.canStart ? (
            <p className="t-small faint">
              {access.message ?? 'You have used every attempt.'}
            </p>
          ) : (
            <StartButton assessmentId={assessment.id} first={used === 0} />
          )}
        </div>
      </Card>

      <section className="mt-8">
        <h2 className="t-heading mb-3">Your attempts</h2>
        {attempts.length === 0 ? (
          <EmptyState title="Not attempted yet" hint="Your results will show here." />
        ) : (
          <Card padded={false}>
            <ul className="divide-y">
              {attempts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">Attempt {a.attemptNo}</p>
                    <p className="t-small faint">
                      {a.submittedAt
                        ? a.submittedAt.toLocaleString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'In progress'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {a.status === 'SUBMITTED' && <Badge tone="warn">awaiting marking</Badge>}
                    {a.status === 'EVALUATED' && a.scorePercent != null && (
                      <>
                        <span className="text-sm font-semibold tabular-nums">{a.scorePercent}%</span>
                        <Badge tone={a.passed ? 'ok' : 'bad'}>{a.passed ? 'passed' : 'not passed'}</Badge>
                      </>
                    )}
                    {a.status === 'IN_PROGRESS' && (
                      <Link href={`/learn/attempt/${a.id}`} className="t-small underline">
                        Resume
                      </Link>
                    )}
                    {a.status === 'EVALUATED' && (
                      <Link href={`/learn/attempt/${a.id}`} className="t-small underline">
                        Review
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="t-micro faint uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
