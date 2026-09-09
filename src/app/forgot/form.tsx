'use client';

import { useActionState } from 'react';
import { requestPasswordReset } from '@/server/password-reset';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState & { deliverable?: boolean } = {};

export function ForgotForm({ emailWorks }: { emailWorks: boolean }) {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);

  if (state.ok) {
    return (
      <div className="space-y-3">
        <FormSuccess message={state.message} />
        {!emailWorks && (
          <p className="t-small rounded-[var(--radius-sm)] border border-dashed p-3 text-[var(--warn)]">
            Email is not connected on this site yet, so nothing has actually been sent. Call the
            academy and they can reset it for you in a moment.
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />

      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" autoFocus />
      </Field>

      <Button type="submit" size="lg" className="w-full justify-center" disabled={pending}>
        {pending ? 'Sending...' : 'Send a reset link'}
      </Button>

      {!emailWorks && (
        <p className="t-small faint">
          Email is not connected on this site yet. Asking here will not reach you, so calling the
          academy is faster.
        </p>
      )}
    </form>
  );
}
