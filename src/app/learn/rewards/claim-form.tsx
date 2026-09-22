'use client';

import { useActionState } from 'react';
import { claimMyVoucher } from '@/server/rewards';
import type { ActionState } from '@/server/courses';
import { Button, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

/** A printed voucher typed or scanned in: it becomes this learner's. */
export function ClaimForm({ prefill }: { prefill: string }) {
  const [state, action, pending] = useActionState(claimMyVoucher, initial);
  return (
    <form action={action} className="space-y-3">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="flex flex-wrap gap-2">
        <Input name="code" defaultValue={prefill} placeholder="V-XXXX-XXXX" autoComplete="off" className="font-mono uppercase" required aria-label="Voucher code" />
        <Button type="submit" disabled={pending}>
          {pending ? 'Checking...' : 'Claim it'}
        </Button>
      </div>
    </form>
  );
}
