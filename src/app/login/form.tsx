'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { login, type LoginState } from '@/server/session';
import { Button, Field, FormError, Input } from '@/components/ui';

const initial: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);

  return (
    <form action={action} className="mt-7 space-y-4">
      <FormError message={state.error} />

      <Field label="Email or mobile">
        <Input name="identifier" autoComplete="username" required autoFocus />
      </Field>

      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      <Button type="submit" disabled={pending} size="lg" className="w-full">
        {pending ? 'Signing in...' : 'Sign in'}
      </Button>
      <p className="t-small faint mt-3 text-center">
        <Link href="/forgot" className="underline">
          Forgotten your password?
        </Link>
      </p>
    </form>
  );
}
