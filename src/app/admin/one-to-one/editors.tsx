'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addBlackout,
  bookOneToOne,
  cancelOneToOne,
  grantCredits,
  offeredSlots,
  removeAvailability,
  saveAvailability,
  type SlotOffer,
} from '@/server/one-to-one';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function AvailabilityEditor({ trainers }: { trainers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveAvailability, initial);
  const [away, awayAction, awayPending] = useActionState(addBlackout, initial);
  const [showAway, setShowAway] = useState(false);
  const router = useRouter();

  if (state.ok || away.ok) setTimeout(() => router.refresh(), 0);

  return (
    <div className="space-y-4 rounded-[var(--radius)] border p-4">
      <form action={action} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Trainer">
            <Select name="userId" required defaultValue="">
              <option value="" disabled>
                Pick a trainer
              </option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Day">
            <Select name="weekday" defaultValue="2">
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="From">
            <Input name="start" defaultValue="18:00" placeholder="18:00" />
          </Field>
          <Field label="To">
            <Input name="end" defaultValue="21:00" placeholder="21:00" />
          </Field>
          <Field label="Slot length">
            <Select name="slotMinutes" defaultValue="30">
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">60 min</option>
            </Select>
          </Field>
        </div>

        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving...' : 'Add these hours'}
          </Button>
          <button
            type="button"
            className="t-small underline"
            onClick={() => setShowAway((was) => !was)}
          >
            {showAway ? 'not away after all' : 'mark a trainer away'}
          </button>
        </div>
      </form>

      {showAway && (
        <form action={awayAction} className="space-y-3 border-t pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Trainer">
              <Select name="userId" required defaultValue="">
                <option value="" disabled>
                  Pick a trainer
                </option>
                {trainers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Why" hint="Optional.">
              <Input name="reason" maxLength={100} placeholder="Leave" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From">
              <Input name="from" type="datetime-local" required />
            </Field>
            <Field label="To">
              <Input name="to" type="datetime-local" required />
            </Field>
          </div>

          <FormError message={away.error} />
          <FormSuccess message={away.ok ? away.message : undefined} />

          <Button type="submit" variant="secondary" disabled={awayPending}>
            {awayPending ? 'Saving...' : 'Mark away'}
          </Button>
        </form>
      )}
    </div>
  );
}

export function CreditGrant({ learners }: { learners: { id: string; name: string; email: string | null }[] }) {
  const [state, action, pending] = useActionState(grantCredits, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-3 rounded-[var(--radius)] border p-4">
      <Field label="Learner">
        <Select name="userId" required defaultValue="">
          <option value="" disabled>
            Pick a learner
          </option>
          {learners.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.email ? ` · ${l.email}` : ''}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Sessions">
          <Input name="sessions" type="number" min={1} max={100} defaultValue={1} />
        </Field>
        <Field label="Each lasting">
          <Select name="minutes" defaultValue="30">
            <option value="30">30 min</option>
            <option value="45">45 min</option>
            <option value="60">60 min</option>
            <option value="90">90 min</option>
          </Select>
        </Field>
        <Field label="Expires" hint="Optional.">
          <Input name="expiresAt" type="datetime-local" />
        </Field>
      </div>

      <Field label="Why" hint="Optional.">
        <Input name="note" maxLength={200} placeholder="Two revision sessions before her exam." />
      </Field>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Give sessions'}
      </Button>
    </form>
  );
}

/**
 * Booking on a learner's behalf, which is how most of these start: they ask
 * on the phone and somebody puts it in the diary while they are talking.
 */
export function BookForLearner({
  learnerId,
  learnerName,
  creditId,
  minutes,
  trainers,
}: {
  learnerId: string;
  learnerName: string;
  creditId: string;
  minutes: number;
  trainers: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [trainerId, setTrainerId] = useState('');
  const [slots, setSlots] = useState<SlotOffer[] | null>(null);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [working, start] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        className="t-small underline"
        style={{ color: 'var(--brand)' }}
        onClick={() => setOpen(true)}
      >
        book
      </button>
    );
  }

  return (
    <div className="w-full rounded-[var(--radius)] border p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="t-small font-medium">Book {minutes} minutes for {learnerName}</p>
        <button type="button" className="t-small faint underline" onClick={() => setOpen(false)}>
          close
        </button>
      </div>

      <div className="mt-2">
        <Select
          value={trainerId}
          onChange={(e) => {
            const id = e.target.value;
            setTrainerId(id);
            setSlots(null);
            setError(undefined);
            if (!id) return;
            start(async () => {
              setSlots(await offeredSlots({ trainerId: id, durationMinutes: minutes }));
            });
          }}
        >
          <option value="">Pick a trainer</option>
          {trainers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>

      {working && <p className="t-small faint mt-2">Looking at their diary...</p>}

      {slots && slots.length === 0 && (
        <p className="t-small mt-2 text-[var(--warn)]">
          Nothing free in the next month. Add hours for them, or check what they are away for.
        </p>
      )}

      {slots && slots.length > 0 && (
        <div className="mt-2 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
          {slots.slice(0, 40).map((slot) => (
            <button
              key={slot.startsAt}
              type="button"
              disabled={working}
              className="rounded-full border px-3 py-1 text-[0.8125rem] hover:bg-[var(--surface-2)]"
              onClick={() =>
                start(async () => {
                  const result = await bookOneToOne({
                    learnerId,
                    trainerId,
                    creditId,
                    startsAt: slot.startsAt,
                  });
                  if (result.ok) {
                    setMessage(result.message);
                    setError(undefined);
                    setOpen(false);
                    router.refresh();
                  } else {
                    setError(result.error);
                  }
                })
              }
            >
              {slot.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="t-small mt-2 text-[var(--bad)]">{error}</p>}
      {message && <p className="t-small mt-2">{message}</p>}
    </div>
  );
}

export function CancelClass({
  kind,
  id,
  label,
}: {
  kind: 'session' | 'availability';
  id: string;
  label: string;
}) {
  const [working, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();

  return (
    <span className="shrink-0">
      <button
        type="button"
        className="t-small underline"
        style={{ color: 'var(--bad)' }}
        disabled={working}
        onClick={() =>
          start(async () => {
            const result =
              kind === 'session' ? await cancelOneToOne(id) : await removeAvailability(id);
            if (result.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        {working ? '...' : label}
      </button>
      {error && <span className="t-small ml-2 text-[var(--bad)]">{error}</span>}
    </span>
  );
}
