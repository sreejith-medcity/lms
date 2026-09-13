'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cancelMiscFee, raiseMiscFee, recordMiscFeePayment, waiveMiscFee } from '@/server/misc-fees';
import type { ActionState } from '@/server/courses';
import type { ReceiptState } from '@/server/fees';
import { Button, Checkbox, Field, FormError, FormSuccess, Input, LinkButton, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export interface FeeTypeChoice {
  id: string;
  name: string;
  amountPaise: number;
  description: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Raising a charge: pick a type and the usual amount fills in, or name it by hand. */
export function RaiseFeeForm({ enrollmentId, types, currency }: { enrollmentId: string; types: FeeTypeChoice[]; currency: string }) {
  const [state, action, pending] = useActionState(raiseMiscFee, initial);
  const [typeId, setTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);
  const chosen = types.find((t) => t.id === typeId);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What for" hint={chosen?.description ?? undefined}>
          <Select
            name="feeTypeId"
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              const t = types.find((x) => x.id === e.target.value);
              if (t && t.amountPaise > 0) setAmount(String(t.amountPaise / 100));
            }}
          >
            <option value="">Something else</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={`Amount (${currency})`}>
          <Input name="amountRupees" type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
      </div>
      {!typeId && (
        <Field label="Call it" hint="What the learner sees on the charge and the receipt.">
          <Input name="label" maxLength={120} placeholder="Re-exam fee" required />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Due by" hint="Blank means whenever; it still shows on their fees page.">
          <Input name="dueDate" type="date" min={today()} />
        </Field>
        <Field label="Note (optional)" hint="For the office.">
          <Input name="note" maxLength={300} />
        </Field>
      </div>
      <Checkbox name="tell" label="Tell the learner" hint="A message with the amount, the date and a link to pay." defaultChecked />
      <Button type="submit" disabled={pending}>{pending ? 'Raising…' : 'Raise the charge'}</Button>
    </form>
  );
}

/** The three ways an open charge closes: taken at the counter, waived with a reason, cancelled. */
export function FeeActions({ feeId, label, canDelete }: { feeId: string; label: string; canDelete: boolean }) {
  const [mode, setMode] = useState<'idle' | 'pay' | 'waive'>('idle');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  if (mode === 'pay') return <TakeFeePayment feeId={feeId} label={label} onDone={() => setMode('idle')} />;
  if (mode === 'waive') return <WaiveFee feeId={feeId} onDone={() => setMode('idle')} />;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setMode('pay')} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)]">
        Take payment
      </button>
      <button type="button" onClick={() => setMode('waive')} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)]">
        Waive
      </button>
      {canDelete && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Cancel ${label}? It stays on the record as cancelled.`)) return;
            start(async () => {
              const r = await cancelMiscFee(feeId);
              setNote(r.error ?? null);
              if (!r.error) router.refresh();
            });
          }}
          className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs text-[var(--bad)] hover:bg-[var(--surface-2)] disabled:opacity-60"
        >
          Cancel
        </button>
      )}
      {note && <span className="t-micro text-[var(--bad)]">{note}</span>}
    </div>
  );
}

function TakeFeePayment({ feeId, label, onDone }: { feeId: string; label: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(recordMiscFeePayment, {} as ReceiptState);
  const [method, setMethod] = useState('CASH');
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);
  const needsReference = method !== 'CASH';

  return (
    <form action={action} className="mt-1 space-y-3 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3">
      <input type="hidden" name="feeId" value={feeId} />
      <p className="t-small font-medium">Taking payment for {label}</p>
      <FormError message={state.error} />
      {state.ok && (
        <div className="space-y-2">
          <FormSuccess message={state.message} />
          {state.receiptNo && (
            <LinkButton href={`/learn/receipts/${state.receiptNo}`} size="sm" variant="secondary" target="_blank">
              Print receipt {state.receiptNo}
            </LinkButton>
          )}
        </div>
      )}
      {!state.ok && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="How">
              <Select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="CASH">Cash</option>
                <option value="UPI">UPI</option>
                <option value="CARD">Card at the counter</option>
                <option value="BANK">Bank transfer</option>
                <option value="CHEQUE">Cheque</option>
              </Select>
            </Field>
            <Field label="Received on">
              <Input name="paidOn" type="date" defaultValue={today()} max={today()} />
            </Field>
          </div>
          <Field label={needsReference ? 'Reference' : 'Reference (optional)'}>
            <Input name="reference" required={needsReference} maxLength={80} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Record and issue receipt'}</Button>
            <Button type="button" size="sm" variant="secondary" onClick={onDone}>Back</Button>
          </div>
        </>
      )}
    </form>
  );
}

function WaiveFee({ feeId, onDone }: { feeId: string; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="mt-1 space-y-2 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3">
      <Field label="Why it is waived" hint="Stays on the record beside the charge.">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </Field>
      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await waiveMiscFee(feeId, reason);
              setError(r.error ?? null);
              if (!r.error) {
                onDone();
                router.refresh();
              }
            })
          }
        >
          {pending ? 'Saving…' : 'Waive it'}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>Back</Button>
      </div>
    </div>
  );
}
