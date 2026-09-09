'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { enrol } from '@/server/enrollment';

export function EnrolButton({ productId, signedIn }: { productId: string; signedIn: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();

  return (
    <div className="text-right">
      <button
        disabled={pending}
        className="inline-flex rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        style={{ background: 'var(--brand)' }}
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
      </button>
      {error && <p className="mt-2 max-w-xs text-xs text-red-600">{error}</p>}
    </div>
  );
}
