'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveAnswer, submitAttempt } from '@/server/attempts';
import { Button, Card, Textarea } from '@/components/ui';

interface Question {
  id: string;
  type: string;
  prompt: string;
  marks: number;
  negative: number;
  options: { id: string; label: string }[];
  saved: unknown;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * The paper.
 *
 * Every answer is written on its own as it is given, so a dropped connection
 * costs the last answer rather than the whole sitting. The countdown is read
 * from a server-issued end time and only ever tells the learner what to expect;
 * the server refuses a late answer regardless of what this clock says.
 */
export function Paper({
  attemptId,
  title,
  endsAt,
  questions,
}: {
  attemptId: string;
  title: string;
  endsAt: string | null;
  questions: Question[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(questions.filter((q) => q.saved != null).map((q) => [q.id, q.saved])),
  );
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [secondsLeft, setSecondsLeft] = useState<number | null>(
    endsAt ? Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000)) : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const persist = useCallback(
    async (questionId: string, response: unknown) => {
      setSaveState((s) => ({ ...s, [questionId]: 'saving' }));
      const res = await saveAnswer(attemptId, questionId, response);
      if (res.expired) {
        router.replace(`/learn/attempt/${attemptId}`);
        return;
      }
      setSaveState((s) => ({ ...s, [questionId]: res.error ? 'failed' : 'saved' }));
    },
    [attemptId, router],
  );

  const setAnswer = useCallback(
    (questionId: string, response: unknown, debounce = 0) => {
      setAnswers((a) => ({ ...a, [questionId]: response }));
      clearTimeout(timers.current[questionId]);
      if (debounce > 0) {
        timers.current[questionId] = setTimeout(() => void persist(questionId, response), debounce);
      } else {
        void persist(questionId, response);
      }
    },
    [persist],
  );

  const submit = useCallback(
    async (auto = false) => {
      setSubmitting(true);
      // Flush anything still waiting on its debounce before the paper closes.
      for (const [id, timer] of Object.entries(timers.current)) {
        clearTimeout(timer);
        if (answers[id] != null) await persist(id, answers[id]);
      }
      const res = await submitAttempt(attemptId);
      if (res.error && !auto) {
        setError(res.error);
        setSubmitting(false);
        return;
      }
      router.replace(`/learn/attempt/${attemptId}`);
    },
    [answers, attemptId, persist, router],
  );

  useEffect(() => {
    if (secondsLeft == null) return;
    if (secondsLeft <= 0) {
      void submit(true);
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => (s == null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, submit]);

  const answered = questions.filter((q) => {
    const a = answers[q.id];
    return Array.isArray(a) ? a.length > 0 : typeof a === 'string' ? a.trim().length > 0 : false;
  }).length;

  const low = secondsLeft != null && secondsLeft <= 120;

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <div className="sticky top-14 z-10 -mx-5 mb-6 border-b bg-[var(--canvas)]/95 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{title}</h1>
            <p className="t-small faint tabular-nums">
              {answered} of {questions.length} answered
            </p>
          </div>

          <div className="flex items-center gap-3">
            {secondsLeft != null && (
              <span
                className="text-lg font-semibold tabular-nums"
                style={{ color: low ? 'var(--bad)' : 'var(--ink)' }}
                aria-live={low ? 'assertive' : 'off'}
              >
                {clock(secondsLeft)}
              </span>
            )}
            <Button disabled={submitting} onClick={() => void submit()}>
              {submitting ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
        </div>

        {low && (
          <p className="t-small mt-2 text-[var(--bad)]">
            Under two minutes. The paper submits itself when the clock runs out, with whatever is
            answered.
          </p>
        )}
      </div>

      {error && <p className="t-small mb-4 text-[var(--bad)]">{error}</p>}

      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.id}>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <p className="t-small faint tabular-nums">
                  Question {i + 1} of {questions.length}
                </p>
                <p className="t-small faint shrink-0 tabular-nums">
                  {q.marks} mark{q.marks === 1 ? '' : 's'}
                  {q.negative > 0 ? `, −${q.negative} if wrong` : ''}
                </p>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{q.prompt}</p>

              <div className="mt-4">
                {q.options.length > 0 ? (
                  <ul className="space-y-1.5">
                    {q.options.map((o) => {
                      const current = (answers[q.id] as string[] | undefined) ?? [];
                      const checked = current.includes(o.id);
                      const multi = q.type === 'MCQ_MULTI';

                      return (
                        <li key={o.id}>
                          <label
                            className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border p-3 text-sm transition ${
                              checked ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'hover:bg-[var(--surface-2)]'
                            }`}
                          >
                            <input
                              type={multi ? 'checkbox' : 'radio'}
                              name={q.id}
                              checked={checked}
                              onChange={() => {
                                const next = multi
                                  ? checked
                                    ? current.filter((id) => id !== o.id)
                                    : [...current, o.id]
                                  : [o.id];
                                setAnswer(q.id, next);
                              }}
                              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
                            />
                            <span>{o.label}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <Textarea
                    rows={q.type === 'LONG_ANSWER' ? 8 : 3}
                    value={(answers[q.id] as string | undefined) ?? ''}
                    onChange={(e) => setAnswer(q.id, e.target.value, 1200)}
                    onBlur={(e) => setAnswer(q.id, e.target.value)}
                    placeholder="Your answer"
                    maxLength={20000}
                  />
                )}
              </div>

              <p className="t-micro faint mt-2 h-4">
                {saveState[q.id] === 'saving' && 'Saving...'}
                {saveState[q.id] === 'saved' && 'Saved'}
                {saveState[q.id] === 'failed' && (
                  <span className="text-[var(--bad)]">Not saved. Check your connection.</span>
                )}
              </p>
            </Card>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex justify-end">
        <Button size="lg" disabled={submitting} onClick={() => void submit()}>
          {submitting ? 'Submitting...' : 'Submit paper'}
        </Button>
      </div>
    </div>
  );
}

function clock(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
