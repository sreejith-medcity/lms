'use client';

import { useActionState } from 'react';
import { verifySecondFactor, type VerifyState } from '@/server/sign-in';
import { Button, Field, FormError, Input } from '@/components/ui';

const initial: VerifyState = {};

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifySecondFactor, initial);

  return (
    <form action={action} className="mt-7 space-y-4">
      <FormError message={state.error} />

      <Field
        label="Six digit code"
        hint="From your authenticator app. A recovery code works here too."
      >
        <Input
          name="code"
          inputMode="text"
          autoComplete="one-time-code"
          required
          autoFocus
        />
      </Field>

      <Button type="submit" disabled={pending} size="lg" className="w-full">
        {pending ? 'Checking...' : 'Continue'}
      </Button>
    </form>
  );
}
