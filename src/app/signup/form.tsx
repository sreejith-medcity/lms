'use client';

import { useActionState, useState } from 'react';
import { register } from '@/server/accounts';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, Input, Select } from '@/components/ui';

const initial: ActionState = {};

export interface ExtraField {
  key: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
}

export function SignupForm({
  referralCode = '',
  primaryField = 'EMAIL',
  extraFields = [],
}: {
  referralCode?: string;
  primaryField?: string;
  extraFields?: ExtraField[];
}) {
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

      <Field
        label="Email"
        hint={primaryField === 'PHONE' ? 'Optional, but receipts go here' : undefined}
      >
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required={primaryField !== 'PHONE'}
        />
      </Field>

      <Field
        label="Mobile"
        hint={primaryField === 'EMAIL' ? 'Optional, used for class reminders' : undefined}
      >
        <Input
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={20}
          required={primaryField !== 'EMAIL'}
        />
      </Field>

      {extraFields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.required ? undefined : 'Optional'}>
          {f.type === 'DROPDOWN' ? (
            <Select name={`cf_${f.key}`} required={f.required} defaultValue="">
              <option value="">Pick one</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          ) : f.type === 'BOOLEAN' ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name={`cf_${f.key}`}
                className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
              />
              <span className="t-small">Yes</span>
            </label>
          ) : (
            <Input
              name={`cf_${f.key}`}
              type={f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : 'text'}
              required={f.required}
              maxLength={200}
            />
          )}
        </Field>
      ))}

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
