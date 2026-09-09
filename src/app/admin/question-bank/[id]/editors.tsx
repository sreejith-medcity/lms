'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteQuestion, saveQuestion } from '@/server/assessments';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

const TYPES = [
  { value: 'MCQ_SINGLE', label: 'Single answer' },
  { value: 'MCQ_MULTI', label: 'Multiple answers' },
  { value: 'TRUE_FALSE', label: 'True or false' },
  { value: 'SHORT_ANSWER', label: 'Short written answer' },
  { value: 'LONG_ANSWER', label: 'Long written answer' },
];

export function QuestionForm({ bankId }: { bankId: string }) {
  const [state, action, pending] = useActionState(saveQuestion, initial);
  const router = useRouter();
  const [type, setType] = useState('MCQ_SINGLE');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correct, setCorrect] = useState<Set<number>>(new Set());

  if (state.ok) {
    setTimeout(() => {
      router.refresh();
      setOptions(['', '', '', '']);
      setCorrect(new Set());
    }, 0);
  }

  const isChoice = type === 'MCQ_SINGLE' || type === 'MCQ_MULTI';
  const isWritten = type === 'SHORT_ANSWER' || type === 'LONG_ANSWER';

  function toggleCorrect(i: number) {
    setCorrect((prev) => {
      if (type === 'MCQ_SINGLE') return new Set(prev.has(i) ? [] : [i]);
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="bankId" value={bankId} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? 'Added.' : undefined} />

      <Field label="Type">
        <Select
          name="type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setCorrect(new Set());
          }}
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Question">
        <Textarea name="promptHtml" rows={3} required maxLength={4000} />
      </Field>

      {isChoice && (
        <div>
          <span className="t-small block font-medium">Options</span>
          <span className="t-small faint mt-0.5 block">
            Tick the correct one{type === 'MCQ_MULTI' ? 's' : ''}. Blank rows are ignored.
          </span>
          <ul className="mt-2 space-y-2">
            {options.map((value, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  type={type === 'MCQ_SINGLE' ? 'radio' : 'checkbox'}
                  name="correct"
                  value={String(i)}
                  checked={correct.has(i)}
                  onChange={() => toggleCorrect(i)}
                  aria-label={`Option ${i + 1} is correct`}
                  className="h-4 w-4 shrink-0 accent-[var(--brand)]"
                />
                <Input
                  name="option"
                  value={value}
                  onChange={(e) =>
                    setOptions((all) => all.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  maxLength={400}
                  placeholder={`Option ${i + 1}`}
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="t-small faint mt-2 underline"
            onClick={() => setOptions((all) => [...all, ''])}
          >
            Add another option
          </button>
        </div>
      )}

      {type === 'TRUE_FALSE' && (
        <Field label="Correct answer">
          <Select name="trueFalse" defaultValue="true">
            <option value="true">True</option>
            <option value="false">False</option>
          </Select>
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Marks">
          <Input name="marks" type="number" step="0.25" min={0.25} max={100} defaultValue={1} />
        </Field>
        <Field label="Negative" hint={isWritten ? 'Not used' : 'For a wrong answer'}>
          <Input
            name="negativeMarks"
            type="number"
            step="0.25"
            min={0}
            max={100}
            defaultValue={0}
            disabled={isWritten}
          />
        </Field>
        <Field label="Difficulty">
          <Select name="difficulty" defaultValue="MEDIUM">
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </Select>
        </Field>
      </div>

      <Field label="Explanation" hint="Shown after marking, so a wrong answer teaches something">
        <Textarea name="explanation" rows={2} maxLength={2000} />
      </Field>

      <Field label="Tags" hint="Comma separated: skill, topic, objective">
        <Input name="tags" maxLength={200} placeholder="inference, part-a" />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding...' : 'Add question'}
      </Button>
    </form>
  );
}

export function DeleteQuestion({ id, answered }: { id: string; answered: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="shrink-0 text-right">
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deleteQuestion(id);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        Delete
      </Button>
      {(error || answered > 0) && (
        <p className="t-small mt-1 max-w-56 text-[var(--bad)]">
          {error ?? `${answered} answered`}
        </p>
      )}
    </div>
  );
}
