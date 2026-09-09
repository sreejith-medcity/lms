'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { saveEvent } from '@/server/products';
import type { ActionState } from '@/server/courses';
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

function forInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
    capacity: number;
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
            defaultValue={forInput(event?.startsAt ?? '')}
            required
          />
        </Field>
        <Field label="Ends">
          <Input name="endsAt" type="datetime-local" defaultValue={forInput(event?.endsAt ?? '')} />
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Capacity" hint="0 for no limit">
          <Input name="capacity" type="number" min={0} max={100000} defaultValue={event?.capacity ?? 0} />
        </Field>
        {!event && (
          <Field label="Ticket price (₹)" hint="0 for free">
            <Input name="priceRupees" type="number" min={0} step="0.01" defaultValue={0} />
          </Field>
        )}
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
          The ticket price is edited on the product&rsquo;s pricing, alongside every other plan.
        </p>
      )}
    </form>
  );
}
