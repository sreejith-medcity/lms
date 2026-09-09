'use client';

import { useActionState, useState, useTransition } from 'react';
import { addPricingPlan, deletePricingPlan, type ActionState } from '@/server/courses';
import { Button, Field, FormError, Input, brandStyle } from '@/components/ui';

const initial: ActionState = {};

export function AddPlanForm({ productId, currency }: { productId: string; currency: string }) {
  const [state, action, pending] = useActionState(addPricingPlan, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="productId" value={productId} />
      <FormError message={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Plan name">
          <Input name="name" placeholder="Full Fees" required maxLength={60} />
        </Field>

        <Field label={`Price (${currency})`} hint="Zero makes the course free">
          <Input name="priceRupees" type="number" min={0} step="0.01" required defaultValue={0} />
        </Field>

        <Field label={`Strike-through price (${currency})`} hint="Optional, shown crossed out">
          <Input name="mrpRupees" type="number" min={0} step="0.01" />
        </Field>

        <Field label="Validity in days" hint="Leave blank for lifetime access">
          <Input name="validityDays" type="number" min={0} step={1} />
        </Field>
      </div>

      <Button type="submit" disabled={pending} style={brandStyle}>
        {pending ? 'Adding...' : 'Add plan'}
      </Button>
    </form>
  );
}

export function DeletePlanButton({ planId, productId }: { planId: string; productId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <span className="flex items-center justify-end gap-2">
      {error && <span className="text-xs text-[var(--bad)]">{error}</span>}
      <Button
        variant="danger"
        disabled={pending}
        title="Plans with enrolments are retired rather than deleted"
        onClick={() => start(async () => setError((await deletePricingPlan(planId, productId)).error))}
      >
        {pending ? '...' : 'Remove'}
      </Button>
    </span>
  );
}
