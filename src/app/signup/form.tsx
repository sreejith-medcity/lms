'use client';

import { useActionState, useState } from 'react';
import { register } from '@/server/accounts';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, Input } from '@/components/ui';

const initial: ActionState = {};

export function SignupForm({ referralCode = '' }: { referralCode?: string }) {
  const [state, action, pending] = useActionState(register, initial);
  // Offered rather than asked: most people do not have one, and an empty box
  // above the button is a question everybody has to read and skip.
  const [showReferral, setShowReferral] = useState(Boolean(referralCode));

  return (
    <form action={action} className="mt-7 space-y-4">
      <FormError message={state.error} />

      <Field label="Full name">
        <Input name="name" autoComplete="name" required maxLength={80} autoFocus />
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

      {showReferral ? (
        <Field label="Referral code" hint="From a friend already learning here.">
          <Input
            name="referralCode"
            defaultValue={referralCode}
            maxLength={16}
            className="font-mono uppercase"
          />
        </Field>
      ) : (
        <button
          type="button"
          className="t-small faint underline"
          onClick={() => setShowReferral(true)}
        >
          Have a referral code?
        </button>
      )}

      <Button type="submit" disabled={pending} size="lg" className="w-full">
        {pending ? 'Creating...' : 'Create account'}
      </Button>
    </form>
  );
}
