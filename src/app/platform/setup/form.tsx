'use client';

import { useActionState } from 'react';
import { createFirstPlatformUser } from '@/server/platform';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, Input } from '@/components/ui';

export function SetupForm() {
  const [state, action, pending] = useActionState(createFirstPlatformUser, {} as ActionState);
  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <Field label="Setup key" hint="PLATFORM_SETUP_KEY from the server environment. Proves you run the box."><Input name="setupKey" required /></Field>
      <Field label="Your name"><Input name="name" required /></Field>
      <Field label="Email"><Input name="email" type="email" required /></Field>
      <Field label="Password" hint="At least ten characters."><Input name="password" type="password" required minLength={10} /></Field>
      <Button type="submit" disabled={pending} className="w-full">{pending ? 'Creating…' : 'Create the first console user'}</Button>
    </form>
  );
}
