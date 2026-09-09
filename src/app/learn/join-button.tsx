'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { joinSession } from '@/server/sessions';
import { Button } from '@/components/ui';

export function JoinButton({ sessionId, live }: { sessionId: string; live: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();

  return (
    <span className="flex items-center gap-2">
      {error && <span className="t-small text-[var(--bad)]">{error}</span>}
      <Button
        size="sm"
        variant={live ? 'primary' : 'secondary'}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await joinSession(sessionId);
            if (res.error) {
              setError(res.error === 'SIGN_IN_REQUIRED' ? 'Please sign in again.' : res.error);
              return;
            }
            // Attendance is already recorded at this point, so a missing link
            // still counts as turning up.
            if (res.url) window.open(res.url, '_blank', 'noopener');
            else setError('No join link on this class yet.');
            router.refresh();
          })
        }
      >
        {pending ? 'Joining...' : live ? 'Join now' : 'Join'}
      </Button>
    </span>
  );
}
