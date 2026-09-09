'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordSettlement, deleteSettlement } from '@/server/settlements';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

export function NewSettlement({
  currency,
  defaultDate,
}: {
  currency: string;
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState(recordSettlement, initial);
  const [gross, setGross] = useState(0);
  const [fee, setFee] = useState(0);
  const [tax, setTax] = useState(0);

  const net = Math.max(0, gross - fee - tax);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Gateway">
          <Select name="gateway" defaultValue="RAZORPAY">
            <option value="RAZORPAY">Razorpay</option>
            <option value="STRIPE">Stripe</option>
            <option value="PAYPAL">PayPal</option>
          </Select>
        </Field>
        <Field label="Settlement id" hint="From the gateway's payout list.">
          <Input name="gatewayRef" required maxLength={80} className="font-mono" placeholder="setl_…" />
        </Field>
        <Field label="Landed on">
          <Input name="settledAt" type="date" required defaultValue={defaultDate} />
        </Field>
        <Field label={`Gross (${currency})`}>
          <Input
            name="grossRupees"
            type="number"
            min={0}
            step="0.01"
            required
            value={gross}
            onChange={(e) => setGross(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label={`Gateway fee (${currency})`}>
          <Input
            name="feeRupees"
            type="number"
            min={0}
            step="0.01"
            value={fee}
            onChange={(e) => setFee(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label={`GST on the fee (${currency})`}>
          <Input
            name="taxRupees"
            type="number"
            min={0}
            step="0.01"
            value={tax}
            onChange={(e) => setTax(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Cover payments up to" hint="Blank means up to the settlement date.">
          <Input name="coverUntil" type="date" />
        </Field>
      </div>

      <p className="t-small muted">
        Net into the bank:{' '}
        <strong>
          {new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(net)}
        </strong>
      </p>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Button type="submit" disabled={pending}>
        {pending ? 'Recording…' : 'Record settlement'}
      </Button>
    </form>
  );
}

export function RemoveSettlement({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <span className="flex items-center justify-end gap-2">
      {error && <span className="t-micro text-[var(--bad)]">{error}</span>}
      <button
        type="button"
        className="t-small faint hover:text-[var(--bad)]"
        disabled={pending}
        title="Removes the settlement and puts its payments back to unsettled"
        onClick={() =>
          start(async () => {
            const res = await deleteSettlement(id);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        Remove
      </button>
    </span>
  );
}
