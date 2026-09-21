'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { requestParentCode, signInParent, type ParentCodeState } from '@/server/parent';
import { Button, Field, FormError, Input } from '@/components/ui';

const initial: ParentCodeState = {};

/** Two steps on one screen, the same shape as the learner's code sign-in. */
export function ParentLoginForm() {
  const [asked, askAction, asking] = useActionState(requestParentCode, initial);
  const [used, useAction, using] = useActionState(signInParent, initial);
  const contact = used.contact ?? asked.contact;
  const stage = asked.sent || used.sent ? 'enter' : 'ask';

  if (stage === 'enter' && contact) {
    return (
      <form action={useAction} className="mt-7 space-y-4">
        <input type="hidden" name="contact" value={contact} />
        {asked.shownCode ? (
          <div className="rounded-[var(--radius)] border border-[var(--brand-line)] bg-[var(--brand-soft)] p-4">
            <p className="t-micro faint uppercase tracking-wide">Pilot: no message provider is connected yet</p>
            <p className="t-title mt-1 tabular-nums">{asked.shownCode}</p>
            <p className="t-small muted mt-1">Your code, shown here instead of sent. It is good for ten minutes.</p>
          </div>
        ) : (
          <p className="t-small muted">
            If a learner here has you on record, a six digit code is on its way to {asked.sentTo ?? 'you'}. It is good for ten minutes.
          </p>
        )}
        <FormError message={used.error} />
        <Field label="Your code">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus defaultValue={asked.shownCode ?? ''} />
        </Field>
        <Button type="submit" disabled={using} size="lg" className="w-full">
          {using ? 'Checking...' : 'See my child'}
        </Button>
        <p className="t-small faint text-center">
          <Link href="/parent/login" className="underline">Use a different number</Link>
        </p>
      </form>
    );
  }

  return (
    <form action={askAction} className="mt-7 space-y-4">
      <FormError message={asked.error} />
      <Field label="Your mobile number or email" hint="The one the academy has on your child's record. A code is sent there; no password.">
        <Input name="contact" autoComplete="tel" required autoFocus />
      </Field>
      <Button type="submit" disabled={asking} size="lg" className="w-full">
        {asking ? 'Sending...' : 'Send me a code'}
      </Button>
      <p className="t-small faint text-center">
        A learner?{' '}
        <Link href="/login" className="underline">Sign in here</Link>
      </p>
    </form>
  );
}
