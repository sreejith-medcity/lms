'use client';

import { useActionState } from 'react';
import { submitEnquiry, type EnquiryState } from '@/server/enquiry';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';
import { TrackEvent } from '@/components/track-event';

const initial: EnquiryState = {};

export function EnquiryForm({ courses }: { courses: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState(submitEnquiry, initial);

  if (state.ok) {
    return (
      <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-8">
        {state.eventId && (
          <TrackEvent once={`lead:${state.eventId}`} event={{ name: 'generate_lead', eventId: state.eventId }} />
        )}
        <FormSuccess message={state.message ?? 'Thanks. We will be in touch.'} />
        <p className="t-small muted mt-3">
          If it is urgent, calling is faster than waiting for a reply.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-[var(--radius)] border bg-[var(--surface)] p-6">
      <FormError message={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <Input name="name" required maxLength={120} autoComplete="name" />
        </Field>
        <Field label="Phone">
          <Input name="phone" type="tel" maxLength={20} autoComplete="tel" />
        </Field>
      </div>

      <Field label="Email" hint="Either a phone number or an email is enough.">
        <Input name="email" type="email" maxLength={160} autoComplete="email" />
      </Field>

      <Field label="What are you interested in?">
        <Select name="interestedIn" defaultValue="">
          <option value="">Not sure yet</option>
          {courses.map((c) => (
            <option key={c.id} value={c.title}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Anything else we should know?">
        <Textarea name="message" rows={4} maxLength={2000} />
      </Field>

      {/* Bots fill everything. Humans never see this. */}
      <div aria-hidden className="hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Sending...' : 'Send enquiry'}
      </Button>
    </form>
  );
}
