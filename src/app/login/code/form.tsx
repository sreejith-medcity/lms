'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { requestCode, signInWithCode, type CodeState } from '@/server/sign-in';
import { Button, Field, FormError, Input } from '@/components/ui';

const initial: CodeState = {};

/**
 * Two steps on one screen.
 *
 * Once a code has been sent the first form is replaced rather than added to,
 * because a screen showing both "send me a code" and "enter your code" invites
 * people to press the wrong one and then wonder why the code stopped working.
 */
export function CodeForm() {
  const [asked, askAction, asking] = useActionState(requestCode, initial);
  const [used, useAction, using] = useActionState(signInWithCode, initial);

  const target = used.target ?? asked.target;
  const stage = asked.sent || used.sent ? 'enter' : 'ask';

  if (stage === 'enter' && target) {
    return (
      <form action={useAction} className="mt-7 space-y-4">
        <input type="hidden" name="target" value={target} />

        <p className="t-small muted">
          If that account exists, a six digit code is on its way to{' '}
          {asked.sentTo ?? 'you'}. It is good for ten minutes.
        </p>

        <FormError message={used.error} />

        <Field label="Your code">
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
          />
        </Field>

        <Button type="submit" disabled={using} size="lg" className="w-full">
          {using ? 'Checking...' : 'Sign in'}
        </Button>

        <p className="t-small faint text-center">
          <Link href="/login/code" className="underline">
            Use a different number
          </Link>
        </p>
      </form>
    );
  }

  return (
    <form action={askAction} className="mt-7 space-y-4">
      <FormError message={asked.error} />

      <Field
        label="Mobile number or email"
        hint="We send a code rather than asking for a password."
      >
        <Input name="identifier" autoComplete="username" required autoFocus />
      </Field>

      <Button type="submit" disabled={asking} size="lg" className="w-full">
        {asking ? 'Sending...' : 'Send me a code'}
      </Button>

      <p className="t-small faint text-center">
        <Link href="/login" className="underline">
          Use a password instead
        </Link>
      </p>
    </form>
  );
}
