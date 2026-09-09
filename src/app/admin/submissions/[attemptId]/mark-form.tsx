'use client';

import { useActionState, useState } from 'react';
import { markSubmission } from '@/server/attempts';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Field, FormError, FormSuccess, Input, Textarea } from '@/components/ui';

const initial: ActionState = {};

interface Item {
  id: string;
  type: string;
  prompt: string;
  maxMarks: number;
  marksAwarded: number | null;
  isCorrect: boolean | null;
  response: unknown;
  options: { id: string; label: string; isCorrect: boolean }[];
}

export function MarkForm({
  attemptId,
  items,
  feedback,
  done,
}: {
  attemptId: string;
  items: Item[];
  feedback: string;
  done: boolean;
}) {
  const [state, action, pending] = useActionState(markSubmission, initial);
  const [marks, setMarks] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      items
        .filter((i) => i.options.length === 0)
        .map((i) => [i.id, i.marksAwarded ?? 0]),
    ),
  );

  const written = items.filter((i) => i.options.length === 0);
  const objective = items.reduce((n, i) => (i.options.length ? n + (i.marksAwarded ?? 0) : n), 0);
  const writtenAwarded = Object.values(marks).reduce((n, m) => n + m, 0);
  const total = items.reduce((n, i) => n + i.maxMarks, 0);
  const running = objective + writtenAwarded;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="attemptId" value={attemptId} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      {items.map((item, i) => (
        <Card key={item.id}>
          <div className="flex items-start justify-between gap-3">
            <p className="t-small faint tabular-nums">Question {i + 1}</p>
            <span className="shrink-0">
              {item.isCorrect === true && <Badge tone="ok">correct</Badge>}
              {item.isCorrect === false && <Badge tone="bad">wrong</Badge>}
              <span className="t-small faint ml-2 tabular-nums">
                {item.options.length > 0 ? `${item.marksAwarded ?? 0}/${item.maxMarks}` : `/${item.maxMarks}`}
              </span>
            </span>
          </div>

          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.prompt}</p>

          {item.options.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {item.options.map((o) => {
                const chosen = Array.isArray(item.response)
                  ? (item.response as string[]).includes(o.id)
                  : false;
                return (
                  <li key={o.id} className="t-small flex items-center gap-2">
                    <span aria-hidden className={o.isCorrect ? 'text-[var(--ok)]' : 'faint'}>
                      {o.isCorrect ? '✓' : chosen ? '✕' : '·'}
                    </span>
                    <span className={chosen ? 'font-medium' : 'muted'}>
                      {o.label}
                      {chosen && <span className="t-micro faint ml-2">their answer</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <>
              <div className="mt-3 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3">
                {typeof item.response === 'string' && item.response.trim() ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.response}</p>
                ) : (
                  <p className="t-small faint">Left blank.</p>
                )}
              </div>

              <div className="mt-3 w-40">
                <Field label={`Marks out of ${item.maxMarks}`}>
                  <Input
                    name={`marks:${item.id}`}
                    type="number"
                    step="0.25"
                    min={0}
                    max={item.maxMarks}
                    value={marks[item.id] ?? 0}
                    onChange={(e) =>
                      setMarks((m) => ({ ...m, [item.id]: Number(e.target.value) || 0 }))
                    }
                    disabled={done}
                  />
                </Field>
              </div>
            </>
          )}
        </Card>
      ))}

      <Card>
        <Field label="Feedback for the learner" hint="They see this with their score.">
          <Textarea name="feedback" rows={4} defaultValue={feedback} maxLength={4000} disabled={done} />
        </Field>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm">
            <span className="faint">Running total </span>
            <span className="font-semibold tabular-nums">
              {running} / {total}
            </span>
            <span className="faint tabular-nums">
              {' '}
              ({total > 0 ? Math.round((running / total) * 100) : 0}%)
            </span>
          </p>

          {!done && (
            <Button type="submit" disabled={pending || written.length === 0}>
              {pending ? 'Saving...' : 'Publish the mark'}
            </Button>
          )}
        </div>

        {done && (
          <p className="t-small faint mt-3">
            Already marked and released. Re-marking is deliberately not a click: a published score
            that changes without a trace is worse than a wrong one.
          </p>
        )}
      </Card>
    </form>
  );
}
