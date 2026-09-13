'use client';

import { useActionState } from 'react';
import { platformLogin } from '@/server/platform';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, Input } from '@/components/ui';

export function PlatformLoginForm() {
  const [state, action, pending] = useActionState(platformLogin, {} as ActionState);
  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <Field label="Email"><Input name="email" type="email" autoComplete="username" required autoFocus /></Field>
      <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      <Button type="submit" disabled={pending} className="w-full">{pending ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  );
}
