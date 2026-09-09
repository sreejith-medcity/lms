'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBank, deleteBank } from '@/server/assessments';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, Input } from '@/components/ui';

const initial: ActionState = {};

export function NewBankForm() {
  const [state, action, pending] = useActionState(createBank, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />

      <Field label="Bank name">
        <Input name="name" required maxLength={120} placeholder="OET Reading" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Exam">
          <Input name="exam" maxLength={40} placeholder="OET" />
        </Field>
        <Field label="Subject">
          <Input name="subject" maxLength={40} placeholder="Reading" />
        </Field>
        <Field label="Topic">
          <Input name="topic" maxLength={40} placeholder="Part A" />
        </Field>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Creating...' : 'Create bank'}
      </Button>
    </form>
  );
}

export function DeleteBank({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="text-right">
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deleteBank(id);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        Delete
      </Button>
      {error && <p className="t-small mt-1 max-w-52 text-[var(--bad)]">{error}</p>}
    </div>
  );
}
