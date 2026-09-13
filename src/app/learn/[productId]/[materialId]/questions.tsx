'use client';

import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { alsoAsk, askQuestion, withdrawQuestion } from '@/server/lesson-questions';
import type { ActionState } from '@/server/courses';
import { Button, FormError, Textarea } from '@/components/ui';
import { stamp } from '@/components/media-player';
import { QUESTION_MAX, askingCount, canWithdraw } from '@/lib/lesson-qa';

const initial: ActionState = {};

export interface QuestionRow {
  id: string;
  userId: string;
  askedBy: string;
  body: string;
  atSeconds: number | null;
  askedAt: string;
  answer: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  alsoAsking: string[];
  isPinned: boolean;
}

/**
 * Questions on this lesson, asked by this batch and answered by the trainer.
 * The tab lives beside the lesson so a question is asked at the moment of
 * confusion, pinned to the second in the recording where it arose, and the
 * answer waits here for the next learner who stalls at the same place.
 */
export function Questions({
  materialId,
  me,
  questions,
  currentTime,
  onSeek,
  discussionHref,
}: {
  materialId: string;
  me: string;
  questions: QuestionRow[];
  currentTime?: number | null;
  onSeek?: (seconds: number) => void;
  discussionHref: string;
}) {
  const [state, action, pending] = useActionState(askQuestion, initial);
  const router = useRouter();
  const [pinned, setPinned] = useState(true);
  const [busy, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  if (state.ok) setTimeout(() => router.refresh(), 0);

  const at = pinned && currentTime != null ? Math.floor(currentTime) : null;
  const waiting = questions.filter((q) => !q.answer).length;

  function run(fn: () => Promise<ActionState>) {
    setProblem(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setProblem(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-2">
        <input type="hidden" name="materialId" value={materialId} />
        {at != null && <input type="hidden" name="atSeconds" value={at} />}
        <FormError message={state.error} />

        <Textarea
          name="body"
          rows={3}
          maxLength={QUESTION_MAX}
          placeholder={
            currentTime != null
              ? `Ask about the moment at ${stamp(at ?? 0)}. Your trainer and your batch will see it.`
              : 'Ask your trainer. Your batch will see the question and the answer.'
          }
          required
        />
        <div className="flex flex-wrap items-center gap-3">
          {currentTime != null && (
            <label className="t-small flex items-center gap-2">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              Pin to {stamp(Math.floor(currentTime))}
            </label>
          )}
          <Button type="submit" disabled={pending} className="ml-auto">
            {pending ? 'Asking…' : 'Ask the trainer'}
          </Button>
        </div>
        {state.ok && state.message && <p className="t-small" style={{ color: 'var(--ok)' }}>{state.message}</p>}
      </form>

      {problem && <FormError message={problem} />}

      {questions.length === 0 ? (
        <p className="t-small faint">No questions on this lesson yet. Yours would be the first.</p>
      ) : (
        <>
          <p className="t-small faint">
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
            {waiting > 0 ? `, ${waiting} waiting for an answer` : ', all answered'}
          </p>
          <ul className="space-y-3">
            {questions.map((q) => {
              const joined = q.alsoAsking.includes(me);
              const mine = q.userId === me;
              return (
                <li key={q.id} className="rounded-[var(--radius)] border bg-[var(--surface)] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {q.isPinned && (
                      <span className="rounded-full px-2 py-0.5 text-[0.6875rem] font-bold" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                        Pinned
                      </span>
                    )}
                    <span className="text-sm font-semibold">{mine ? 'You' : q.askedBy}</span>
                    {q.atSeconds != null && (
                      onSeek ? (
                        <button
                          type="button"
                          onClick={() => onSeek(q.atSeconds ?? 0)}
                          className="t-small font-semibold underline"
                          style={{ color: 'var(--brand)' }}
                        >
                          at {stamp(q.atSeconds)}
                        </button>
                      ) : (
                        <span className="t-small faint">at {stamp(q.atSeconds)}</span>
                      )
                    )}
                    <span className="t-small faint ml-auto">{q.askedAt}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{q.body}</p>

                  {q.answer ? (
                    <div className="mt-3 rounded-[var(--radius-sm)] border-l-4 bg-[var(--surface-2)] p-3" style={{ borderColor: 'var(--brand)' }}>
                      <p className="t-small font-semibold">
                        {q.answeredBy ?? 'Trainer'}
                        {q.answeredAt && <span className="faint font-normal"> · {q.answeredAt}</span>}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{q.answer}</p>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <span className="t-small faint">
                        Waiting for the trainer · {askingCount(q)} {askingCount(q) === 1 ? 'person' : 'people'} asking
                      </span>
                      {!mine && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(() => alsoAsk(q.id))}
                          className="t-small rounded-full border px-3 py-1 font-semibold"
                          style={joined ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : undefined}
                        >
                          {joined ? 'You have this question too' : 'I have this question too'}
                        </button>
                      )}
                      {canWithdraw({ userId: q.userId, answeredAt: q.answeredAt ? new Date(q.answeredAt) : null }, me) && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(() => withdrawQuestion(q.id))}
                          className="t-small ml-auto underline"
                          style={{ color: 'var(--bad)' }}
                        >
                          Take it back
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="t-small faint">
        For a conversation with the whole course rather than a question on this lesson,{' '}
        <Link href={discussionHref} className="underline" style={{ color: 'var(--brand)' }}>
          open the discussion
        </Link>
        .
      </p>
    </div>
  );
}
