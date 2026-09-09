'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { completePasswordReset } from '@/server/password-reset';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(completePasswordReset, initial);

  if (state.ok) {
    return (
      <div className="space-y-4">
        <FormSuccess message={state.message} />
        <Link
          href="/login"
          className="inline-flex h-11 items-center rounded-[var(--radius-sm)] px-5 text-sm font-medium text-[var(--brand-ink)]"
          style={{ background: 'var(--brand)' }}
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <FormError message={state.error} />

      <Field label="New password" hint="At least eight characters.">
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" autoFocus />
      </Field>

      <Field label="Again">
        <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </Field>

      <Button type="submit" size="lg" className="w-full justify-center" disabled={pending}>
        {pending ? 'Saving...' : 'Change my password'}
      </Button>

      <p className="t-small faint">
        Changing it signs you out everywhere else, in case someone else is in your account.
      </p>
    </form>
  );
}
