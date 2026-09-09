'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { startAttempt } from '@/server/attempts';
import { Button } from '@/components/ui';

export function StartButton({ assessmentId, first }: { assessmentId: string; first: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div>
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await startAttempt(assessmentId);
            if (res.attemptId) router.push(`/learn/attempt/${res.attemptId}`);
            else setError(res.error);
          })
        }
      >
        {pending ? 'Starting...' : first ? 'Start' : 'Start another attempt'}
      </Button>
      {error && <p className="t-small mt-2 text-[var(--bad)]">{error}</p>}
    </div>
  );
}
