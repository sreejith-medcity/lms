'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createRole, deleteRole } from '@/server/team';
import type { ActionState } from '@/server/courses';
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function NewRoleForm({ roles }: { roles: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createRole, initial);
  const router = useRouter();

  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Role name">
        <Input name="name" required maxLength={80} placeholder="Branch Manager" />
      </Field>

      <Field label="Description" hint="What this role is for, in one line">
        <Textarea name="description" rows={2} maxLength={200} />
      </Field>

      <Field label="Start from" hint="Copies that role's permissions as a starting point">
        <Select name="copyFromId" defaultValue="">
          <option value="">No permissions</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>

      <Checkbox
        name="restrictBatchAccess"
        label="Only their own batches"
        hint="They see batches where they are the tutor or manager, and nothing else."
      />

      <Button type="submit" disabled={pending}>
        {pending ? 'Creating...' : 'Create role'}
      </Button>
    </form>
  );
}

export function DeleteRole({ id }: { id: string }) {
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
            const res = await deleteRole(id);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        Delete
      </Button>
      {error && <p className="t-small mt-1 text-[var(--bad)]">{error}</p>}
    </div>
  );
}
