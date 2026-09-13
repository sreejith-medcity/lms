'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveFeeType, setFeeTypeActive } from '@/server/misc-fees';
import type { ActionState } from '@/server/courses';
import { Button, Checkbox, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

export interface FeeTypeDraft {
  id: string;
  name: string;
  amountPaise: number;
  taxable: boolean;
  description: string;
}

export function FeeTypeForm({ draft, currency }: { draft: FeeTypeDraft | null; currency: string }) {
  const [state, action, pending] = useActionState(saveFeeType, initial);
  return (
    <form action={action} className="space-y-4">
      {draft && <input type="hidden" name="id" value={draft.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" hint="Exam fee, Study material, Certificate reissue, Late fee.">
          <Input name="name" defaultValue={draft?.name ?? ''} required maxLength={80} />
        </Field>
        <Field label={`Usual amount (${currency})`} hint="Filled in when the fee is raised; can be changed then.">
          <Input name="amountRupees" type="number" min={0} step="0.01" defaultValue={draft ? draft.amountPaise / 100 : ''} />
        </Field>
        <Field label="What it covers" hint="Shown to the learner beside the charge.">
          <Input name="description" defaultValue={draft?.description ?? ''} maxLength={200} />
        </Field>
      </div>
      <Checkbox name="taxable" label="GST applies when paid online" hint="Untick for money passed straight to a board or a partner, which carries no tax of yours." defaultChecked={draft?.taxable ?? true} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : draft ? 'Save changes' : 'Add fee type'}</Button>
        {draft && (
          <a href="/admin/fees/types" className="t-small muted hover:underline">
            Cancel
          </a>
        )}
      </div>
    </form>
  );
}

export function FeeTypeActions({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`/admin/fees/types?edit=${id}`} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)]">
        Edit
      </a>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setFeeTypeActive(id, !isActive);
            setNote(r.error ?? null);
            if (!r.error) router.refresh();
          })
        }
        className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)] disabled:opacity-60"
      >
        {isActive ? 'Retire' : 'Bring back'}
      </button>
      {note && <span className="t-micro text-[var(--bad)]">{note}</span>}
    </div>
  );
}
