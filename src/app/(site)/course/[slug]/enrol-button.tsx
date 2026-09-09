'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { enrol } from '@/server/enrollment';
import { Button } from '@/components/ui';

export function EnrolButton({
  productId,
  signedIn,
  fullWidth = false,
}: {
  productId: string;
  signedIn: boolean;
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
              router.push('/signup');
              return;
            }
            const res = await enrol(productId);
            if (res?.error === 'SIGN_IN_REQUIRED') router.push('/login');
            else setError(res?.error);
          })
        }
      >
        {pending ? 'Enrolling...' : signedIn ? 'Enrol now' : 'Sign up to enrol'}
      </Button>
      {error && <p className="t-small mt-2 max-w-xs text-[var(--bad)]">{error}</p>}
    </div>
  );
}
