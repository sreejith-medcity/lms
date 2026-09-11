'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startInstalmentCheckout } from '@/server/fees';
import { Button, FormError } from '@/components/ui';

export function PayInstalment({ instalmentId, label }: { instalmentId: string; label: string }) {
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
            const res = await startInstalmentCheckout(instalmentId);
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
