'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { drawMarkSheet } from '@/server/mark-sheets';
import { Button, Select } from '@/components/ui';

/**
 * An online paper's marks become a mark sheet for one batch, so they go
 * to the Branch Head the way a paper test does and reach parents only
 * once published. The learner's own view of their attempt is unchanged.
 */
export function DrawSheet({ assessmentId, batches }: { assessmentId: string; batches: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [batchId, setBatchId] = useState(batches[0]?.id ?? '');
  const [error, setError] = useState<string>();
  if (batches.length === 0) return null;
  return (
    <div className="space-y-2">
      <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} aria-label="Batch">
        {batches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || !batchId}
        onClick={() =>
          start(async () => {
            const res = await drawMarkSheet(assessmentId, batchId);
            if (res.error) setError(res.error);
            else if (res.id) router.push(`/admin/marksheets/${res.id}`);
          })
        }
      >
        {pending ? 'Drawing…' : 'Draw a mark sheet for approval'}
      </Button>
      {error && <p className="t-small text-[var(--bad)]">{error}</p>}
    </div>
  );
}
