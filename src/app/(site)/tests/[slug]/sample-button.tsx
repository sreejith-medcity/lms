'use client';

import { useState, useTransition } from 'react';
import { startSampleAction } from '@/server/tests';

export function SampleButton({ formatCode }: { formatCode: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startSampleAction(formatCode);
            if (r && !r.ok) setError(r.error);
          })
        }
        className="inline-flex h-11 w-full items-center justify-center rounded-[var(--radius-sm)] bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--brand-ink)] disabled:opacity-50"
      >
        {pending ? 'Opening…' : 'Start my free paper'}
      </button>
      <p className="t-small faint mt-2">It starts in exam mode, with the clocks. Set aside the time before you press.</p>
      {error && <p className="t-small mt-2 text-[var(--bad)]">{error}</p>}
    </div>
  );
}
