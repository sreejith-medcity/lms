'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bulkGradeHandIns } from '@/server/assignments';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, FormError, FormSuccess, Input, Textarea } from '@/components/ui';
import { trimNumber } from '@/lib/assignment-rules';

const initial: ActionState = {};

export function MarkAllForm({
  assignmentId,
  maxMarks,
  rows,
  canMark,
}: {
  assignmentId: string;
  maxMarks: number;
  rows: { id: string; learner: string; attemptNo: number; text: string; when: string; late: boolean; files: { assetId: string; name: string; size: string }[] }[];
  canMark: boolean;
}) {
  const [state, action, pending] = useActionState(bulkGradeHandIns, initial);
  const router = useRouter();
  const [filled, setFilled] = useState<Record<string, boolean>>({});
  const count = Object.values(filled).filter(Boolean).length;

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      {rows.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {r.learner}
              {r.attemptNo > 1 && <span className="t-small faint"> · attempt {r.attemptNo}</span>}
              {r.late && (
                <>
                  {' '}
                  <Badge tone="warn">late</Badge>
                </>
              )}
            </p>
            <span className="t-small faint">{r.when}</span>
          </div>
          {r.text ? (
            <div className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3 text-sm leading-relaxed">{r.text}</div>
          ) : (
            <p className="t-small faint mt-3">No written answer; the work is in the files.</p>
          )}
          {r.files.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {r.files.map((f) => (
                <li key={f.assetId}>
                  <a href={`/api/assets/${f.assetId}`} target="_blank" rel="noreferrer" className="t-small inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 hover:bg-[var(--surface-2)]">
                    {f.name} <span className="faint">{f.size}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <label className="block">
              <span className="t-small block font-medium">Out of {trimNumber(maxMarks)}</span>
              <Input
                name={`marks:${r.id}`}
                type="number"
                min={0}
                max={maxMarks}
                step="0.5"
                className="mt-1.5"
                disabled={!canMark}
                onChange={(e) => setFilled((f) => ({ ...f, [r.id]: e.target.value.trim() !== '' }))}
              />
            </label>
            <label className="block">
              <span className="t-small block font-medium">Feedback</span>
              <Textarea name={`feedback:${r.id}`} rows={2} maxLength={10_000} className="mt-1.5" disabled={!canMark} />
            </label>
          </div>
        </Card>
      ))}

      {canMark && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="t-small faint">A hand-in with a blank mark is left waiting. Returning one for another go is done from its own page.</p>
          <Button type="submit" disabled={pending || count === 0}>
            {pending ? 'Marking...' : `Mark ${count} of ${rows.length}`}
          </Button>
        </div>
      )}
    </form>
  );
}
