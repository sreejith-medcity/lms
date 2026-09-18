'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { verifyHomework } from '@/server/mark-sheets';
import { Badge, Button, Card } from '@/components/ui';

type Verification = 'COMPLETE' | 'INCOMPLETE' | 'RESUBMIT';

export interface VerifyRow {
  userId: string;
  name: string;
  submissionId: string | null;
  handedIn: string | null;
  late: boolean;
  attempt: number;
  verification: Verification | null;
  status: 'SUBMITTED' | 'GRADED' | 'RETURNED' | null;
  feedback: string;
  marks: number | null;
}

const OPTIONS: { value: Verification; label: string; tone: 'ok' | 'warn' | 'bad' }[] = [
  { value: 'COMPLETE', label: 'Complete', tone: 'ok' },
  { value: 'INCOMPLETE', label: 'Incomplete', tone: 'warn' },
  { value: 'RESUBMIT', label: 'Hand in again', tone: 'bad' },
];

function stateOf(r: VerifyRow): { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' } {
  if (!r.submissionId) return { label: 'not submitted', tone: 'bad' };
  if (r.verification === 'COMPLETE') return { label: 'verified complete', tone: 'ok' };
  if (r.verification === 'INCOMPLETE') return { label: 'incomplete', tone: 'warn' };
  if (r.verification === 'RESUBMIT') return { label: 'resubmission required', tone: 'bad' };
  return { label: 'awaiting verification', tone: 'neutral' };
}

export function VerifyList({ rows, canEdit }: { rows: VerifyRow[]; canEdit: boolean }) {
  const counts = rows.reduce(
    (n, r) => {
      const s = stateOf(r).label;
      n[s] = (n[s] ?? 0) + 1;
      return n;
    },
    {} as Record<string, number>,
  );
  return (
    <div className="space-y-4">
      <p className="t-small faint">
        {Object.entries(counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(' · ')}
      </p>
      <Card padded={false}>
        <ul className="divide-y">
          {rows.map((r) => (
            <Row key={r.userId} row={r} canEdit={canEdit} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Row({ row, canEdit }: { row: VerifyRow; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState(row.feedback);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const state = stateOf(row);

  function set(v: Verification) {
    if (!row.submissionId) return;
    start(async () => {
      const res = await verifyHomework(row.submissionId!, v, feedback);
      if (res.error) setError(res.error);
      else {
        setError(undefined);
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <li className="px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="t-micro faint">
            {row.handedIn ? `handed in ${row.handedIn}${row.late ? ', late' : ''}${row.attempt > 1 ? `, attempt ${row.attempt}` : ''}` : 'nothing handed in'}
            {row.marks !== null ? ` · marked ${row.marks}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={state.tone}>{state.label}</Badge>
          {canEdit && row.submissionId && !open && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
              {row.verification ? 'Change' : 'Verify'}
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <input
            className="w-full rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
            placeholder="Feedback (optional). Reaches the parent by the approval rule under Settings."
            value={feedback}
            maxLength={1000}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {OPTIONS.map((o) => (
              <Button key={o.value} size="sm" variant={o.value === 'RESUBMIT' ? 'danger' : o.value === 'COMPLETE' ? 'primary' : 'secondary'} disabled={pending} onClick={() => set(o.value)}>
                {o.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <p className="t-small mt-1 text-[var(--bad)]">{error}</p>}
    </li>
  );
}
