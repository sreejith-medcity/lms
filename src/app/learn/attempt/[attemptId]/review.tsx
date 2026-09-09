import Link from 'next/link';
import { Badge, Card } from '@/components/ui';

interface ReviewQuestion {
  id: string;
  type: string;
  prompt: string;
  explanation: string | null;
  marks: number;
  marksAwarded: number | null;
  isCorrect: boolean | null;
  response: unknown;
  options: { id: string; label: string; isCorrect: boolean }[];
}

/**
 * What you got, and why.
 *
 * A score with no working shown teaches nothing, so every question is replayed
 * with the answer given, the answer expected, and the explanation the author
 * wrote. While written answers are still with a trainer the percentage is
 * withheld rather than shown as provisional, because a number people see is a
 * number people remember.
 */
export function Review({
  attempt,
  assessment,
  questions,
  feedback,
  awaitingMarking,
}: {
  attempt: {
    id: string;
    attemptNo: number;
    status: string;
    scorePercent: number | null;
    passed: boolean | null;
    submittedAt: string | null;
  };
  assessment: { id: string; title: string; passPercent: number; showResults: boolean };
  questions: ReviewQuestion[];
  feedback: string | null;
  awaitingMarking: boolean;
}) {
  const total = questions.reduce((n, q) => n + q.marks, 0);
  const awarded = questions.reduce((n, q) => n + (q.marksAwarded ?? 0), 0);
  const showAnswers = !awaitingMarking && assessment.showResults;

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <Link href={`/learn/assessment/${assessment.id}`} className="t-small faint hover:underline">
        {assessment.title}
      </Link>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Attempt {attempt.attemptNo}</h1>
      {attempt.submittedAt && (
        <p className="t-small faint mt-1">
          Submitted{' '}
          {new Date(attempt.submittedAt).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      )}

      <Card className="mt-6">
        {awaitingMarking ? (
          <>
            <p className="text-lg font-medium">With your trainer</p>
            <p className="t-small muted mt-1 max-w-prose">
              The written answers are being marked. Your score appears here once they are done,
              rather than showing you a partial number now and a different one later.
            </p>
          </>
        ) : attempt.scorePercent != null ? (
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="t-micro faint uppercase tracking-wide">Score</p>
              <p className="mt-1 text-4xl font-semibold leading-none tracking-tight">
                {attempt.scorePercent}%
              </p>
              <p className="t-small faint mt-1 tabular-nums">
                {awarded} of {total} marks
              </p>
            </div>
            <Badge tone={attempt.passed ? 'ok' : 'bad'}>
              {attempt.passed ? 'Passed' : 'Not passed'} · pass mark {assessment.passPercent}%
            </Badge>
          </div>
        ) : (
          <p className="t-small muted">This attempt has no score recorded.</p>
        )}

        {feedback && (
          <div className="mt-5 border-t pt-5">
            <p className="t-micro faint uppercase tracking-wide">Trainer feedback</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{feedback}</p>
          </div>
        )}
      </Card>

      {showAnswers && (
        <ol className="mt-8 space-y-4">
          {questions.map((q, i) => {
            const chosen = Array.isArray(q.response) ? (q.response as string[]) : [];
            const written = typeof q.response === 'string' ? q.response : null;

            return (
              <li key={q.id}>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <p className="t-small faint tabular-nums">Question {i + 1}</p>
                    <span className="shrink-0">
                      {q.isCorrect === true && <Badge tone="ok">correct</Badge>}
                      {q.isCorrect === false && <Badge tone="bad">wrong</Badge>}
                      <span className="t-small faint ml-2 tabular-nums">
                        {q.marksAwarded ?? 0}/{q.marks}
                      </span>
                    </span>
                  </div>

                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{q.prompt}</p>

                  {q.options.length > 0 ? (
                    <ul className="mt-3 space-y-1.5">
                      {q.options.map((o) => {
                        const picked = chosen.includes(o.id);
                        return (
                          <li
                            key={o.id}
                            className={`flex items-start gap-2.5 rounded-[var(--radius-sm)] border p-2.5 text-sm ${
                              o.isCorrect
                                ? 'border-[var(--ok)] bg-[var(--ok-soft)]'
                                : picked
                                  ? 'border-[var(--bad)] bg-[var(--bad-soft)]'
                                  : ''
                            }`}
                          >
                            <span aria-hidden className="shrink-0">
                              {o.isCorrect ? '✓' : picked ? '✕' : '·'}
                            </span>
                            <span>
                              {o.label}
                              {picked && <span className="t-micro faint ml-2">your answer</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : written ? (
                    <div className="mt-3 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3">
                      <p className="t-micro faint uppercase tracking-wide">Your answer</p>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{written}</p>
                    </div>
                  ) : (
                    <p className="t-small faint mt-3">You left this blank.</p>
                  )}

                  {q.explanation && (
                    <div className="mt-3 border-t pt-3">
                      <p className="t-micro faint uppercase tracking-wide">Why</p>
                      <p className="t-small muted mt-1 leading-relaxed">{q.explanation}</p>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      {!showAnswers && !awaitingMarking && (
        <p className="t-small faint mt-6">
          Your academy has chosen not to release the answers for this assessment.
        </p>
      )}
    </div>
  );
}
