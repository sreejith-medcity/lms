'use client';

import { useState, useTransition } from 'react';
import { unsubscribeByToken } from '@/server/consent';
import type { ActionState } from '@/server/courses';
import { Button, FormError, FormSuccess } from '@/components/ui';

export function UnsubscribeForm({ token, channel }: { token: string; channel: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  if (state.ok) return <FormSuccess message={state.message} />;
  return (
    <div className="space-y-3">
      <Button disabled={pending} onClick={() => start(async () => setState(await unsubscribeByToken(token, channel)))}>
        {pending ? 'One moment...' : 'Yes, stop them'}
      </Button>
      <FormError message={state.error} />
    </div>
  );
}
