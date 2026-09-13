'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { quizFromAsset, summariseAsset } from '@/server/tutor';
import type { ActionState } from '@/server/courses';
import { Button, FormError } from '@/components/ui';

/**
 * What the model can make from a transcript: study notes onto the
 * transcript itself, and a first draft of quiz questions into a bank.
 * Drafts are tagged so nobody mistakes them for a trainer's questions.
 */
export function LessonTools({
  assetId,
  hasSummary,
  banks,
}: {
  assetId: string;
  hasSummary: boolean;
  banks: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [bankId, setBankId] = useState(banks[0]?.id ?? '');
  const [count, setCount] = useState(8);
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const router = useRouter();

  function run(fn: () => Promise<ActionState>) {
    setNote(undefined);
    setProblem(undefined);
    start(async () => {
      const r = await fn();
      if (r.error) setProblem(r.error);
      else {
        setNote(r.message);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="t-small">
          Lesson tools <span className="faint">· {hasSummary ? 'summary written' : 'no summary yet'}</span>
        </span>
        <button type="button" className="t-small ml-auto underline" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Open'}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => summariseAsset(assetId))}>
              {busy ? 'Working…' : hasSummary ? 'Rewrite the summary' : 'Write a summary and chapters'}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bankId}
              onChange={(e) => setBankId(e.target.value)}
              className="t-small h-8 rounded border bg-[var(--surface)] px-2"
              aria-label="Question bank"
            >
              {banks.length === 0 && <option value="">No question bank yet</option>}
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="t-small h-8 w-16 rounded border px-2"
              aria-label="How many questions"
            />
            <Button size="sm" variant="secondary" disabled={busy || !bankId} onClick={() => run(() => quizFromAsset(assetId, bankId, count))}>
              Draft quiz questions
            </Button>
          </div>
          {note && <p className="t-small" style={{ color: 'var(--ok)' }}>{note}</p>}
          {problem && <FormError message={problem} />}
        </div>
      )}
    </div>
  );
}
