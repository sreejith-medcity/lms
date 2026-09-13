'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startInstalmentCheckout } from '@/server/fees';
import { startMiscFeeCheckout } from '@/server/misc-fees';
import { Button, FormError } from '@/components/ui';

/** The same button pays an instalment or one of the other charges; the kind says which order is started. */
export function PayInstalment({ instalmentId, label, kind = 'instalment' }: { instalmentId: string; label: string; kind?: 'instalment' | 'fee' }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = kind === 'fee' ? await startMiscFeeCheckout(instalmentId) : await startInstalmentCheckout(instalmentId);
            if (res.ok) router.push(`/checkout/${res.orderId}`);
            else setError(res.error);
          })
        }
      >
        {pending ? 'One moment...' : label}
      </Button>
      <FormError message={error} />
    </div>
  );
}
