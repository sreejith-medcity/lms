'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parentPayInstalment, parentPayMiscFee } from '@/server/parent-pay';
import { Button, FormError } from '@/components/ui';

/**
 * The parent's Pay button. Confirms the child and the amount first, then
 * starts the child's order and hands over to the same checkout the
 * learner would use. A second press while the first is in flight does
 * nothing, and a payment window closed and reopened lands on the same
 * order.
 */
export function ParentPay({ childId, childName, id, kind, amountLabel, label }: { childId: string; childName: string; id: string; kind: 'instalment' | 'fee'; amountLabel: string; label: string }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const router = useRouter();

  if (confirming) {
    return (
      <div className="space-y-2">
        <p className="t-small">
          Pay {amountLabel} for {childName}? You will be taken to the academy&rsquo;s payment page.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = kind === 'fee' ? await parentPayMiscFee(childId, id) : await parentPayInstalment(childId, id);
                if (res.ok) router.push(`/checkout/${res.orderId}?as=parent&child=${childId}`);
                else setError(res.error);
              })
            }
          >
            {pending ? 'One moment…' : `Yes, pay ${amountLabel}`}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
            Not now
          </Button>
        </div>
        <FormError message={error} />
      </div>
    );
  }
  return (
    <Button size="sm" onClick={() => setConfirming(true)}>
      {label}
    </Button>
  );
}
