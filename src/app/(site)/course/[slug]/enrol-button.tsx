'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { enrol } from '@/server/enrollment';
import { startCheckout } from '@/server/checkout';
import { Button } from '@/components/ui';

export function EnrolButton({
  productId,
  signedIn,
  isPaid = false,
  pricingPlanId,
  fullWidth = false,
}: {
  productId: string;
  signedIn: boolean;
  isPaid?: boolean;
  pricingPlanId?: string;
  fullWidth?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();

  return (
    <div className={fullWidth ? '' : 'text-right'}>
      <Button
        disabled={pending}
        size="lg"
        className={fullWidth ? 'w-full justify-center' : ''}
        onClick={() =>
          start(async () => {
            if (!signedIn) {
              // Come back to this course after signing in rather than dumping
              // the visitor on a dashboard and making them find it again.
              router.push(`/signup?next=${encodeURIComponent(window.location.pathname)}`);
              return;
            }

            if (isPaid) {
              const started = await startCheckout(productId, pricingPlanId);
              if (started.ok) router.push(`/checkout/${started.orderId}`);
              else if (started.signIn) router.push('/login');
              else setError(started.error);
              return;
            }

            const res = await enrol(productId);
            if (res?.error === 'SIGN_IN_REQUIRED') router.push('/login');
            else setError(res?.error);
          })
        }
      >
        {pending
          ? isPaid
            ? 'Opening checkout...'
            : 'Enrolling...'
          : signedIn
            ? isPaid
              ? 'Enrol now'
              : 'Enrol free'
            : 'Sign up to enrol'}
      </Button>
      {error && <p className="t-small mt-2 max-w-xs text-[var(--bad)]">{error}</p>}
    </div>
  );
}
