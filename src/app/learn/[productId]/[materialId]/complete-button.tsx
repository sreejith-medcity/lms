'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setMaterialComplete } from '@/server/enrollment';

export function CompleteButton({
  productId,
  materialId,
  done,
  nextHref,
}: {
  productId: string;
  materialId: string;
  done: boolean;
  nextHref: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-red-600">{error}</span>}

      <button
        disabled={pending}
        className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60 ${
          done ? 'border bg-white text-slate-700' : 'text-white'
        }`}
        style={done ? undefined : { background: 'var(--brand)' }}
        onClick={() =>
          start(async () => {
            const res = await setMaterialComplete(productId, materialId, !done);
            if (res.error) {
              setError(res.error);
              return;
            }
            if (!done) router.push(nextHref);
            else router.refresh();
          })
        }
      >
        {pending ? 'Saving...' : done ? 'Mark as not done' : 'Mark complete and continue'}
      </button>
    </div>
  );
}
