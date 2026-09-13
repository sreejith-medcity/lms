'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approvePayout, deletePayout, drawUpPayouts, markPayoutPaid, reopenPayout, setPayoutAdjustment } from '@/server/payouts';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};
const today = () => new Date().toISOString().slice(0, 10);

/** Month picker and the draw-up button. Changing the month reloads the page on it. */
export function MonthBar({ months, selected, canEdit }: { months: { key: string; label: string }[]; selected: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Month">
        <Select value={selected} onChange={(e) => router.push(`/admin/payouts?month=${e.target.value}`)} className="w-48">
          {months.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </Select>
      </Field>
      {canEdit && (
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await drawUpPayouts(selected);
              setNote(r.error ?? r.message ?? null);
              if (!r.error) router.refresh();
            })
          }
        >
          {pending ? 'Working…' : 'Draw up from the calendar'}
        </Button>
      )}
      {note && <span className="t-small muted">{note}</span>}
    </div>
  );
}

export function PayoutActions({ id, status, canDelete }: { id: string; status: string; canDelete: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      setNote(r.error ?? null);
      if (!r.error) router.refresh();
    });
  const btn = 'rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)] disabled:opacity-60';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'DRAFT' && (
        <button type="button" disabled={pending} onClick={() => run(() => approvePayout(id))} className={btn}>Approve</button>
      )}
      {status === 'APPROVED' && (
        <button type="button" disabled={pending} onClick={() => run(() => reopenPayout(id))} className={btn}>Reopen</button>
      )}
      {status === 'DRAFT' && canDelete && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm('Remove this draft? It can be drawn up again.')) return;
            run(() => deletePayout(id));
          }}
          className={`${btn} text-[var(--bad)]`}
        >
          Remove
        </button>
      )}
      {note && <span className="t-micro text-[var(--bad)]">{note}</span>}
    </div>
  );
}

export function AdjustmentForm({ id, adjustmentRupees, note, locked }: { id: string; adjustmentRupees: number; note: string; locked: boolean }) {
  const [state, action, pending] = useActionState(setPayoutAdjustment, initial);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <Field label="Adjustment" hint="Plus or minus, on top of the classes. A bonus, a deduction for a class that did not happen, a travel allowance.">
        <Input name="adjustmentRupees" type="number" step="0.01" defaultValue={adjustmentRupees} disabled={locked} />
      </Field>
      <Field label="Why">
        <Textarea name="adjustmentNote" rows={2} defaultValue={note} maxLength={300} disabled={locked} />
      </Field>
      {!locked && <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Save adjustment'}</Button>}
    </form>
  );
}

export function MarkPaidForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(markPayoutPaid, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid on">
          <Input name="paidOn" type="date" defaultValue={today()} max={today()} />
        </Field>
        <Field label="Reference" hint="UTR, cheque number, or how it went.">
          <Input name="reference" maxLength={120} />
        </Field>
      </div>
      <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Mark as paid'}</Button>
    </form>
  );
}
