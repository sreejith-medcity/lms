'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { retryFulfilment } from '@/server/fulfilment-retry';
import { Button } from '@/components/ui';

/**
 * The button beside a refusal.
 *
 * It asks Razorpay what happened and runs the same fulfilment the webhook
 * runs, so a fixed cause becomes a finished enrolment without anybody
 * touching the database.
 */
export function RetryFulfilment({
  orderId,
  gatewayPaymentId,
}: {
  orderId: string;
  gatewayPaymentId: string;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ ok?: boolean; text?: string }>({});
  const router = useRouter();

  return (
    <div className="shrink-0 text-right">
      <Button
        variant="secondary"
        disabled={pending || !gatewayPaymentId}
        onClick={() =>
          start(async () => {
            const result = await retryFulfilment(orderId, gatewayPaymentId);
            setState({ ok: result.ok, text: result.ok ? result.message : result.error });
            if (result.ok) router.refresh();
          })
        }
      >
        {pending ? 'Checking...' : 'Try again'}
      </Button>
      {state.text && (
        <p
          className={`t-small mt-2 max-w-[22rem] ${state.ok ? '' : 'text-[var(--bad)]'}`}
          role="status"
        >
          {state.text}
        </p>
      )}
    </div>
  );
}
