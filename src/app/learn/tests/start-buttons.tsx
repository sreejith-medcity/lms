'use client';

import { useState, useTransition } from 'react';
import { startTest } from '@/server/tests';

/** Start a paper in exam mode (clocks, one pass) or practice mode (no clocks, free movement). */
export function StartButtons({ formatCode, assignmentId, practice, label }: { formatCode: string; assignmentId?: string; practice: boolean; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = (mode: 'exam' | 'practice') =>
    start(async () => {
      setError(null);
      const r = await startTest(formatCode, mode, assignmentId ?? null);
      if (r && !r.ok) setError(r.error);
    });
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => go('exam')} className="rounded-[var(--radius-sm)] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-[var(--brand-ink)] disabled:opacity-50">
          {pending ? 'Opening…' : label}
        </button>
        {practice && (
          <button type="button" disabled={pending} onClick={() => go('practice')} className="rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
            Practice mode
          </button>
        )}
      </div>
      {practice && <p className="t-small faint mt-2">Each start uses one paper. Practice mode has no clocks and lets you move between parts.</p>}
      {error && <p className="t-small mt-2 text-[var(--bad)]">{error}</p>}
    </div>
  );
}
