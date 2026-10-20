'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { saveEvent } from '@/server/products';
import type { ActionState } from '@/server/courses';
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function EventForm({
  event,
}: {
  event?: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    isOnline: boolean;
    venue: string;
    summary: string;
    joinUrl: string;
    capacity: number;
    priceRupees: number;
    status: string;
  };
}) {
  const [state, action, pending] = useActionState(saveEvent, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      {event && <input type="hidden" name="id" value={event.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Title">
        <Input name="title" defaultValue={event?.title} required maxLength={160} placeholder="OET open day" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts">
          <Input
            name="startsAt"
            type="datetime-local"
            defaultValue={event?.startsAt ?? ''}
            required
          />
        </Field>
        <Field label="Ends">
          <Input name="endsAt" type="datetime-local" defaultValue={event?.endsAt ?? ''} />
        </Field>
      </div>

      <Checkbox
        name="isOnline"
        label="Online"
        hint="Turn off and it needs a venue."
        defaultChecked={event?.isOnline ?? true}
      />

      <Field label="Venue">
        <Input name="venue" defaultValue={event?.venue} maxLength={240} placeholder="Kannur campus, hall 2" />
      </Field>

      <Field label="Joining link" hint="For an online event. Only people with a place see it, from half an hour before.">
        <Input name="joinUrl" type="url" defaultValue={event?.joinUrl} maxLength={500} placeholder="https://zoom.us/j/..." />
      </Field>

      <Field label="About it" hint="Who it is for and what happens. Shown on the event page.">
        <Textarea name="summary" defaultValue={event?.summary} maxLength={2000} rows={4} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Capacity" hint="0 for no limit">
          <Input name="capacity" type="number" min={0} max={100000} defaultValue={event?.capacity ?? 0} />
        </Field>
        <Field label="Ticket price (₹)" hint="0 for free">
          <Input name="priceRupees" type="number" min={0} step="0.01" defaultValue={event?.priceRupees ?? 0} />
        </Field>
      </div>

      <Field label="Status">
        <Select name="status" defaultValue={event?.status ?? 'DRAFT'}>
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
        </Select>
      </Field>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : event ? 'Save event' : 'Create event'}
        </Button>
        {event && (
          <a href="/admin/events" className="t-small faint self-center underline">
            New instead
          </a>
        )}
      </div>

      {event && (
        <p className="t-small faint">
          A new price applies to places taken from now on. What earlier people paid stays on their record.
        </p>
      )}
    </form>
  );
}
