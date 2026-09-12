'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changePassword, signOutOtherDevices } from '@/server/account';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, initial);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Current password">
          <Input name="current" type="password" autoComplete="current-password" required />
        </Field>
        <Field label="New password">
          <Input name="next" type="password" autoComplete="new-password" required minLength={8} placeholder="At least 8 characters" />
        </Field>
        <Field label="New password again">
          <Input name="again" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
      </div>
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Changing...' : 'Change password'}
      </Button>
    </form>
  );
}

export function DevicesPanel({ others }: { others: number }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string>();
  const router = useRouter();
  if (others === 0) return <span className="t-small faint">Only this device</span>;
  return (
    <span className="flex items-center gap-2">
      {message && <span className="t-small faint">{message}</span>}
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await signOutOtherDevices();
            setMessage(res.message ?? res.error);
            router.refresh();
          })
        }
      >
        {pending ? '...' : `Sign out ${others} other device${others === 1 ? '' : 's'}`}
      </Button>
    </span>
  );
}
