'use client';

import { useActionState } from 'react';
import { submitEnquiry, type EnquiryState } from '@/server/enquiry';
import { Button, Field, FormError, FormSuccess, Input, Textarea } from '@/components/ui';
import { TrackEvent } from '@/components/track-event';
import { CaptchaField } from '@/components/captcha-field';

const initial: EnquiryState = {};

/**
 * "Talk to a counsellor" on a course page.
 *
 * Most people who reach a course page from an advert are not ready to pay on
 * the first visit; on the old store the landing pages had only an Enquire Now
 * button that went somewhere else. This asks for a name and a number, writes
 * a lead that already names the course (the server reads it from the page's
 * product, not from the form), and keeps the visitor where they were.
 */
export function CourseEnquiry({
  productId,
  courseTitle,
  captcha = null,
}: {
  productId: string;
  courseTitle: string;
  captcha?: { provider: 'recaptcha' | 'turnstile'; siteKey: string } | null;
}) {
  const [state, action, pending] = useActionState(submitEnquiry, initial);

  if (state.ok) {
    return (
      <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-6">
        {state.eventId && <TrackEvent once={`lead:${state.eventId}`} event={{ name: 'generate_lead', eventId: state.eventId }} />}
        <FormSuccess message={state.message ?? 'Thanks. A counsellor will call you back.'} />
        <p className="t-small muted mt-3">We have noted that you are asking about {courseTitle}.</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-[var(--radius)] border bg-[var(--surface)] p-6">
      <FormError message={state.error} />
      <input type="hidden" name="productId" value={productId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <Input name="name" required maxLength={120} autoComplete="name" />
        </Field>
        <Field label="Phone or WhatsApp">
          <Input name="phone" type="tel" required maxLength={20} autoComplete="tel" inputMode="tel" />
        </Field>
      </div>

      <Field label="Email" hint="Optional.">
        <Input name="email" type="email" maxLength={160} autoComplete="email" />
      </Field>

      <Field label="Your question" hint="Optional: a batch time, the fee, whether it suits your level.">
        <Textarea name="message" rows={3} maxLength={2000} />
      </Field>

      {/* Bots fill everything. Humans never see this. */}
      <div aria-hidden className="hidden">
        <label htmlFor="course-enquiry-website">Website</label>
        <input id="course-enquiry-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {captcha && <CaptchaField provider={captcha.provider} siteKey={captcha.siteKey} action="enquiry" />}
      <Button type="submit" disabled={pending}>
        {pending ? 'Sending...' : 'Call me back'}
      </Button>
    </form>
  );
}
