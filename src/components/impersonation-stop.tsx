'use client';

import { useTransition } from 'react';
import { stopImpersonating } from '@/server/learners';

export function StopImpersonating() {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await stopImpersonating()))}
      className="rounded-[var(--radius-sm)] bg-white/20 px-3 py-1 text-sm font-medium hover:bg-white/30 disabled:opacity-60"
    >
      {pending ? 'Returning…' : 'Back to admin'}
    </button>
  );
}
