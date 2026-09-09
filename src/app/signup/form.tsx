'use client';

import { useActionState } from 'react';
import { register } from '@/server/accounts';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, Input, brandStyle } from '@/components/ui';

const initial: ActionState = {};

export function SignupForm() {
  const [state, action, pending] = useActionState(register, initial);

  return (
    <form action={action} className="mt-6 space-y-4">
      <FormError message={state.error} />

      <Field label="Full name">
        <Input name="name" autoComplete="name" required maxLength={80} />
      </Field>

      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>

      <Field label="Mobile" hint="Optional, used for class reminders">
        <Input name="phone" type="tel" autoComplete="tel" maxLength={20} />
      </Field>

      <Field label="Password" hint="At least 8 characters">
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>

      <Button type="submit" disabled={pending} className="w-full" style={brandStyle}>
        {pending ? 'Creating...' : 'Create account'}
      </Button>
    </form>
  );
}
