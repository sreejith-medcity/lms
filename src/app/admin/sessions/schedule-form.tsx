'use client';

import { useActionState, useState } from 'react';
import { scheduleSessions } from '@/server/sessions';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

const DAYS = [
  { value: 'MO', label: 'M' },
  { value: 'TU', label: 'T' },
  { value: 'WE', label: 'W' },
  { value: 'TH', label: 'T' },
  { value: 'FR', label: 'F' },
  { value: 'SA', label: 'S' },
  { value: 'SU', label: 'S' },
];

export function ScheduleForm({
  batches,
}: {
  batches: { id: string; name: string; course: string }[];
}) {
  const [state, action, pending] = useActionState(scheduleSessions, initial);
  const [repeat, setRepeat] = useState(4);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      {state.ok && <FormSuccess message="Classes scheduled." />}

      <Field label="Batch">
        <Select name="batchId" required defaultValue="">
          <option value="" disabled>
            Choose a batch
          </option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {b.course}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Class name">
        <Input name="title" required maxLength={160} placeholder="A1 Group Class" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">
          <Input name="startDate" type="date" required defaultValue={today} />
        </Field>
        <Field label="Time">
          <Input name="startTime" type="time" required defaultValue="18:45" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Minutes">
          <Input name="durationMinutes" type="number" min={5} max={600} step={5} defaultValue={60} required />
        </Field>
        <Field label="Repeat weeks" hint="0 for a one-off">
          <Input
            name="repeatWeeks"
            type="number"
            min={0}
            max={52}
            value={repeat}
            onChange={(e) => setRepeat(Number(e.target.value))}
          />
        </Field>
      </div>

      {repeat > 0 && (
        <Field label="On these days">
          <div className="flex gap-1.5">
            {DAYS.map((d, i) => (
              <label key={d.value} className="flex-1">
                <input type="checkbox" name="days" value={d.value} className="peer sr-only" />
                <span className="block cursor-pointer rounded-[var(--radius-sm)] border py-2 text-center text-xs font-medium peer-checked:border-[var(--brand)] peer-checked:bg-[var(--brand-soft)] peer-checked:text-[var(--brand)]">
                  {d.label}
                  <span className="sr-only">{['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
      )}

      <Field label="Join link" hint="Zoom or Meet. Native classes come later.">
        <Input name="joinUrl" type="url" placeholder="https://zoom.us/j/..." />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Scheduling...' : repeat > 0 ? 'Schedule series' : 'Schedule class'}
      </Button>
    </form>
  );
}
