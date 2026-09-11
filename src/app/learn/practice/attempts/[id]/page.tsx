import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { presetFor } from '@/lib/ai-evaluation';
import { Card, LinkButton } from '@/components/ui';
import { EvaluationReport, evaluationFromJson } from '@/components/evaluation-report';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Practice report' };

/** One report: the mark, the examiner's notes, and the answer they were about. */
export default async function PracticeReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const attempt = await db.practiceAttempt.findFirst({
    where: { id, organizationId: tenant.organizationId, userId: user.id },
  });
  if (!attempt) notFound();

  const preset = presetFor(attempt.exam);
  const evaluation = evaluationFromJson(attempt.evaluation);
  const meta = (attempt.evaluation ?? {}) as { pass?: boolean; words?: number };

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <Link href="/learn/practice" className="t-small faint hover:underline">
        Practice
      </Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{preset?.label ?? attempt.exam}</h1>
          <p className="t-small faint mt-1">
            {attempt.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            {meta.words ? ` · ${meta.words} words` : ''}
            {attempt.durationSeconds ? ` · ${Math.floor(attempt.durationSeconds / 60)} min ${attempt.durationSeconds % 60} s` : ''}
          </p>
        </div>
        <LinkButton href={`/learn/practice/${attempt.exam}`} size="sm">
          Try another
        </LinkButton>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          {evaluation && preset ? (
            <EvaluationReport
              evaluation={evaluation}
              scale={preset.scale}
              scoreLabel={attempt.scoreLabel ?? String(attempt.score ?? '')}
              pass={typeof meta.pass === 'boolean' ? meta.pass : null}
            />
          ) : (
            <p className="t-small faint">The report for this attempt could not be read.</p>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <p className="t-eyebrow faint">The task</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{attempt.prompt}</p>
          </Card>
          <Card>
            <p className="t-eyebrow faint">{attempt.kind === 'SPEAKING' ? 'What you said' : 'What you wrote'}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{attempt.response}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
