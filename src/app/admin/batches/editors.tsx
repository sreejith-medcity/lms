'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBatch, setBatchStatus } from '@/server/enrolments';
import type { ActionState } from '@/server/courses';
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

export function NewBatchForm({
  courses,
  branches,
}: {
  courses: { id: string; title: string }[];
  branches: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createBatch, initial);
  const router = useRouter();

  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Course">
        <Select name="courseId" required defaultValue="">
          <option value="" disabled>
            Choose a course
          </option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Branch">
        <Select name="branchId" required defaultValue={branches[0]?.id ?? ''}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Batch name" hint="What the trainers call it">
        <Input name="name" required maxLength={120} placeholder="A1 Morning — Oct" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts">
          <Input name="startDate" type="date" />
        </Field>
        <Field label="Ends">
          <Input name="endDate" type="date" />
        </Field>
      </div>

      <Field label="Capacity" hint="0 for no limit. Seats left show at enrolment.">
        <Input name="capacity" type="number" min={0} max={10000} defaultValue={0} />
      </Field>

      <Checkbox
        name="isDefault"
        label="Make this the default batch for the course"
        hint="Where a learner lands when nobody picks a batch for them."
      />

      <Button type="submit" disabled={pending || courses.length === 0 || branches.length === 0}>
        {pending ? 'Creating...' : 'Create batch'}
      </Button>
    </form>
  );
}

const STATUSES = ['UPCOMING', 'ACTIVE', 'COMPLETED', 'ARCHIVED'] as const;

export function BatchStatus({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div>
      <select
        value={status}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const res = await setBatchStatus(
              id,
              e.target.value as (typeof STATUSES)[number],
            );
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
        aria-label="Batch status"
        className="h-8 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 text-[0.8125rem] capitalize"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.toLowerCase()}
          </option>
        ))}
      </select>
      {error && <p className="t-small mt-1 text-[var(--bad)]">{error}</p>}
    </div>
  );
}
