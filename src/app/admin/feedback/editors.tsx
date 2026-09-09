'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createFeedbackForm,
  deleteFeedbackForm,
  setFeedbackFormActive,
} from '@/server/feedback';
import { ANSWER_LABELS, QUESTION_TYPES } from '@/lib/feedback';
import type { ActionState } from '@/server/courses';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
} from '@/components/ui';

const initial: ActionState = {};

interface Draft {
  label: string;
  type: string;
  options: string;
  required: boolean;
}

const BLANK: Draft = { label: '', type: 'TEXT', options: '', required: false };

export function FormBuilder() {
  const [state, action, pending] = useActionState(createFeedbackForm, initial);
  const [questions, setQuestions] = useState<Draft[]>([
    { label: 'How was the class?', type: 'RATING', options: '', required: true },
    { label: 'Anything you would change?', type: 'TEXT', options: '', required: false },
  ]);

  function update(i: number, changes: Partial<Draft>) {
    setQuestions((qs) => qs.map((q, index) => (index === i ? { ...q, ...changes } : q)));
  }

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Form name">
          <Input name="name" placeholder="Weekly class feedback" required maxLength={120} />
        </Field>
        <Field label="What it asks about">
          <Select name="type" defaultValue="SESSION">
            <option value="SESSION">A class</option>
            <option value="BATCH">A batch</option>
            <option value="TRAINER">A trainer</option>
            <option value="EVENT">An event</option>
            <option value="CUSTOM">Anything else</option>
          </Select>
        </Field>
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <div key={i} className="rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field label={`Question ${i + 1}`}>
                <Input
                  name="questionLabel"
                  value={q.label}
                  maxLength={200}
                  placeholder="What should we do differently?"
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              </Field>
              <Field label="Answered as">
                <Select
                  name="questionType"
                  value={q.type}
                  onChange={(e) => update(i, { type: e.target.value })}
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ANSWER_LABELS[t] ?? t}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* Sent whatever the type, so the parallel arrays stay aligned. */}
            <input type="hidden" name="questionRequired" value={q.required ? 'true' : 'false'} />

            <div className="mt-3 flex flex-wrap items-end gap-4">
              <div className="min-w-56 flex-1">
                <Field
                  label="Choices"
                  hint={q.type === 'CHOICE' ? 'Separated by commas.' : 'Only used for a list.'}
                >
                  <Input
                    name="questionOptions"
                    value={q.options}
                    disabled={q.type !== 'CHOICE'}
                    placeholder="Too fast, About right, Too slow"
                    onChange={(e) => update(i, { options: e.target.value })}
                  />
                </Field>
              </div>
              <Checkbox
                label="Must be answered"
                checked={q.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />
              {questions.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setQuestions((qs) => qs.filter((_, index) => index !== i))}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={questions.length >= 30}
          onClick={() => setQuestions((qs) => [...qs, { ...BLANK }])}
        >
          Add a question
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create form'}
        </Button>
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
    </form>
  );
}

export function FormState({
  id,
  isActive,
  hasResponses,
}: {
  id: string;
  isActive: boolean;
  hasResponses: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        title={isActive ? 'Stop taking answers' : 'Take answers again'}
        onClick={() =>
          start(async () => {
            const res = await setFeedbackFormActive(id, !isActive);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        <Badge tone={isActive ? 'ok' : 'neutral'}>{isActive ? 'open' : 'closed'}</Badge>
      </button>
      {!hasResponses && (
        <button
          type="button"
          aria-label="Delete this form"
          className="t-micro faint hover:text-[var(--bad)]"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await deleteFeedbackForm(id);
              setError(res.error);
              if (!res.error) router.refresh();
            })
          }
        >
          delete
        </button>
      )}
      {error && <span className="t-micro text-[var(--bad)]">{error}</span>}
    </span>
  );
}
