'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createInstalmentPlan } from '@/server/money';
import { recordFeePayment, sendFeeReminder, type ReceiptState } from '@/server/fees';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, LinkButton, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function PlanForm({ enrollments }: { enrollments: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(createInstalmentPlan, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Enrolment">
        <Select name="enrollmentId" required defaultValue="">
          <option value="" disabled>
            Choose a learner
          </option>
          {enrollments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Total fee (₹)">
          <Input name="totalRupees" type="number" min={1} step="0.01" required />
        </Field>
        <Field label="Instalments">
          <Input name="count" type="number" min={2} max={24} defaultValue={3} required />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First due">
          <Input name="firstDue" type="date" required />
        </Field>
        <Field label="Then every" hint="Days">
          <Input name="intervalDays" type="number" min={7} max={180} defaultValue={30} required />
        </Field>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Creating...' : 'Create the plan'}
      </Button>
    </form>
  );
}

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * The cashier's form. Amount first, because that is what is in hand; the
 * quick buttons fill in the next instalment or the whole balance.
 */
export function CounterPaymentForm({
  enrollmentId,
  balanceRupees,
  nextRupees,
}: {
  enrollmentId: string;
  balanceRupees: number;
  nextRupees: number;
}) {
  const [state, action, pending] = useActionState(recordFeePayment, {} as ReceiptState);
  const [amount, setAmount] = useState(String(nextRupees));
  const [method, setMethod] = useState('CASH');
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);

  const needsReference = method !== 'CASH';

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
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

      <Field label="Amount received (₹)">
        <Input
          name="amountRupees"
          type="number"
          min={1}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button type="button" className="t-small rounded-full border px-2 py-0.5 hover:bg-[var(--surface-2)]" onClick={() => setAmount(String(nextRupees))}>
            Next instalment ₹{nextRupees.toLocaleString('en-IN')}
          </button>
          {balanceRupees !== nextRupees && (
            <button type="button" className="t-small rounded-full border px-2 py-0.5 hover:bg-[var(--surface-2)]" onClick={() => setAmount(String(balanceRupees))}>
              Whole balance ₹{balanceRupees.toLocaleString('en-IN')}
            </button>
          )}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
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

      <Field label={needsReference ? 'Reference' : 'Reference (optional)'} hint={method === 'CHEQUE' ? 'Cheque number and bank' : method === 'UPI' ? 'UTR or transaction id' : undefined}>
        <Input name="reference" required={needsReference} maxLength={80} />
      </Field>

      <Field label="Note (optional)">
        <Textarea name="note" rows={2} maxLength={300} />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Record and issue receipt'}
      </Button>
    </form>
  );
}

export function ReminderButton({ enrollmentId }: { enrollmentId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const router = useRouter();

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await sendFeeReminder(enrollmentId);
            setState(res);
            if (res.ok) router.refresh();
          })
        }
      >
        {pending ? 'Queueing...' : 'Send a reminder now'}
      </Button>
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
    </div>
  );
}
