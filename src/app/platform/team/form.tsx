'use client';

import { useActionState } from 'react';
import { addPlatformUser } from '@/server/platform';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

export function AddUserForm() {
  const [state, action, pending] = useActionState(addPlatformUser, {} as ActionState);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-4">
      <div className="sm:col-span-4"><FormError message={state.error} /><FormSuccess message={state.ok ? state.message : undefined} /></div>
      <Field label="Name"><Input name="name" required /></Field>
      <Field label="Email"><Input name="email" type="email" required /></Field>
      <Field label="Password"><Input name="password" type="password" required minLength={10} /></Field>
      <Field label="Role">
        <Select name="role" defaultValue="SUPPORT">
          <option value="OWNER">Owner</option>
          <option value="ENGINEER">Engineer</option>
          <option value="SUPPORT">Support</option>
          <option value="BILLING">Billing</option>
          <option value="READ_ONLY">Read only</option>
        </Select>
      </Field>
      <div className="sm:col-span-4"><Button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add console user'}</Button></div>
    </form>
  );
}
