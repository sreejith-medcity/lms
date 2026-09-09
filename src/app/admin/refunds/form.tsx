'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { recordOfflineRefund } from '@/server/money';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function OfflineRefundForm({ payments }: { payments: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(recordOfflineRefund, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);

  if (payments.length === 0) {
    return (
      <p className="t-small faint">
        No offline payments to refund. Everything taken so far went through the gateway.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Payment">
        <Select name="paymentId" required defaultValue="">
          <option value="" disabled>
            Choose the payment
          </option>
          {payments.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Amount returned (₹)" hint="Part of it is fine. A full refund ends access.">
        <Input name="amountRupees" type="number" min={1} step="0.01" required />
      </Field>

      <Field label="Reason" hint="Goes on the record against your name.">
        <Textarea name="reason" rows={2} required maxLength={300} />
      </Field>

      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? 'Recording...' : 'Record the refund'}
      </Button>
    </form>
  );
}
