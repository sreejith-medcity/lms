'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { setFirstPassword } from '@/server/account-claim';
import { Button, Field, FormError, FormSuccess, Input } from '@/components/ui';

/**
 * The last step of a guest purchase.
 *
 * They are already signed in at this point, so this is not a barrier between
 * them and what they bought: the links to start learning are right there. It
 * is the one moment they will ever be this willing to pick a password, so it
 * is asked once, here, and never nagged about again.
 */
export function SetPassword({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState(setFirstPassword, {});

  if (state.ok) {
    return (
      <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-5">
        <FormSuccess message={state.message} />
        <p className="t-small muted mt-2">
          Sign in with {email ?? 'your email'} next time.{' '}
          <Link href="/learn" className="underline">
            Go to my learning
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="rounded-[var(--radius)] border bg-[var(--surface)] p-5">
      <h2 className="t-heading">Set a password</h2>
      <p className="t-small muted mt-1">
        Your account is ready{email ? ` for ${email}` : ''}. Pick a password so you can sign back in
        on any device.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Password">
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        <Field label="Repeat it">
          <Input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
      </div>

      <FormError message={state.error} />

      <Button type="submit" disabled={pending} className="mt-4">
        {pending ? 'Saving...' : 'Save password'}
      </Button>
    </form>
  );
}
