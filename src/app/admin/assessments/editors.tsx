'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { createAssessment } from '@/server/assessments';
import type { ActionState } from '@/server/courses';
import { Button, Checkbox, Field, FormError, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState & { id?: string } = {};

export const KINDS = [
  { value: 'TEST', label: 'Test' },
  { value: 'MOCK_EXAM', label: 'Mock exam' },
  { value: 'ASSIGNMENT', label: 'Assignment' },
  { value: 'PRACTICE', label: 'Practice' },
];

export function NewAssessmentForm() {
  const [state, action, pending] = useActionState(createAssessment, initial);
  const router = useRouter();

  if (state.ok && state.id) setTimeout(() => router.push(`/admin/assessments/${state.id}`), 0);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />

      <Field label="Title">
        <Input name="title" required maxLength={160} placeholder="OET Reading — Mock 1" />
      </Field>

      <Field label="Kind">
        <Select name="kind" defaultValue="TEST">
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Minutes" hint="0 = untimed">
          <Input name="durationMinutes" type="number" min={0} max={600} defaultValue={0} />
        </Field>
        <Field label="Attempts">
          <Input name="maxAttempts" type="number" min={1} max={20} defaultValue={1} />
        </Field>
        <Field label="Pass %">
          <Input name="passPercent" type="number" min={0} max={100} defaultValue={40} />
        </Field>
      </div>

      <Field label="Instructions">
        <Textarea name="instructions" rows={3} maxLength={4000} />
      </Field>

      <Checkbox name="shuffleQuestions" label="Shuffle the question order" />
      <Checkbox
        name="showResultsImmediately"
        label="Show the score as soon as it is submitted"
        hint="Off for anything a trainer has to mark by hand first."
        defaultChecked
      />

      <Button type="submit" disabled={pending}>
        {pending ? 'Creating...' : 'Create assessment'}
      </Button>
    </form>
  );
}
