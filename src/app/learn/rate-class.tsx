'use client';

import { useActionState, useState } from 'react';
import { submitFeedback } from '@/server/feedback';
import type { ActionState } from '@/server/courses';
import type { FeedbackQuestion } from '@/lib/feedback';
import { Button, Card, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

/**
 * "How was it?"
 *
 * Asked on the dashboard rather than emailed, and only about a class the learner
 * actually sat, which is the difference between feedback and a survey. One tap
 * on a star is a complete answer; the rest is optional and says so.
 */
export function RateClass({
  formId,
  questions,
  sessions,
}: {
  formId: string;
  questions: FeedbackQuestion[];
  sessions: { id: string; title: string; when: string }[];
}) {
  const [state, action, pending] = useActionState(submitFeedback, initial);
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const [rating, setRating] = useState(0);
  const [open, setOpen] = useState(false);

  if (sessions.length === 0) return null;
  if (state.ok) {
    return (
      <Card>
        <FormSuccess message={state.message ?? 'Thank you.'} />
      </Card>
    );
  }

  const chosen = sessions.find((s) => s.id === sessionId) ?? sessions[0];
  const extras = questions.filter((q) => q.type !== 'RATING');

  return (
    <Card>
      <form action={action} className="space-y-4">
        <input type="hidden" name="formId" value={formId} />
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="rating" value={rating} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="t-heading">How was {chosen.title}?</h2>
            <p className="t-small faint">{chosen.when}</p>
          </div>

          <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating out of five">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                role="radio"
                aria-checked={rating === star}
                aria-label={`${star} out of 5`}
                onClick={() => {
                  setRating(star);
                  setOpen(true);
                }}
                className={`text-2xl leading-none transition ${
                  star <= rating ? 'text-[var(--warn)]' : 'text-[var(--ink-3)] hover:text-[var(--warn)]'
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        {sessions.length > 1 && (
          <Field label="Which class?">
            <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.when}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {open && extras.length > 0 && (
          <div className="space-y-4 border-t pt-4">
            {extras.map((q) => (
              <Field
                key={q.key}
                label={q.label}
                hint={q.required ? undefined : 'Optional'}
              >
                {q.type === 'TEXT' ? (
                  <Textarea name={`q_${q.key}`} rows={3} maxLength={2000} required={q.required} />
                ) : q.type === 'CHOICE' ? (
                  <Select name={`q_${q.key}`} defaultValue="" required={q.required}>
                    <option value="">Pick one</option>
                    {(q.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : q.type === 'YES_NO' ? (
                  <Select name={`q_${q.key}`} defaultValue="" required={q.required}>
                    <option value="">Pick one</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </Select>
                ) : (
                  <Input
                    name={`q_${q.key}`}
                    type="number"
                    min={1}
                    max={10}
                    required={q.required}
                  />
                )}
              </Field>
            ))}
          </div>
        )}

        <FormError message={state.error} />

        {open && (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending || rating === 0}>
              {pending ? 'Sending…' : 'Send'}
            </Button>
            <button
              type="button"
              className="t-small faint hover:underline"
              onClick={() => {
                setRating(0);
                setOpen(false);
              }}
            >
              Not now
            </button>
          </div>
        )}
      </form>
    </Card>
  );
}
