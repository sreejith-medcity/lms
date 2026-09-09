'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveCommunity, setCommunityActive, moderatePost } from '@/server/community';
import type { ActionState } from '@/server/courses';
import { VISIBILITY } from '@/lib/community';
import {
  Badge,
  Button,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
  Textarea,
} from '@/components/ui';

const initial: ActionState = {};

export function NewCommunity() {
  const [state, action, pending] = useActionState(saveCommunity, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" required maxLength={120} placeholder="German learners" />
        </Field>
        <Field label="Who can see it">
          <Select name="visibility" defaultValue="ENROLLED">
            {VISIBILITY.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="What it is for" hint="Optional. Shown at the top of the room.">
        <Textarea name="description" rows={2} maxLength={400} />
      </Field>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Button type="submit" disabled={pending}>
        {pending ? 'Opening…' : 'Open room'}
      </Button>
    </form>
  );
}

export function CommunityState({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        title={isActive ? 'Close the room' : 'Open it again'}
        onClick={() =>
          start(async () => {
            const res = await setCommunityActive(id, !isActive);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        <Badge tone={isActive ? 'ok' : 'neutral'}>{isActive ? 'open' : 'closed'}</Badge>
      </button>
      {error && <span className="t-micro text-[var(--bad)]">{error}</span>}
    </span>
  );
}

export function PostControls({
  id,
  isPinned,
  isFlagged,
}: {
  id: string;
  isPinned: boolean;
  isFlagged: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  function run(action: 'PIN' | 'UNPIN' | 'CLEAR_FLAG' | 'DELETE') {
    start(async () => {
      const res = await moderatePost(id, action);
      setError(res.error);
      if (!res.error) router.refresh();
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {error && <span className="t-micro text-[var(--bad)]">{error}</span>}
      {isFlagged && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run('CLEAR_FLAG')}>
          Leave it up
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(isPinned ? 'UNPIN' : 'PIN')}
      >
        {isPinned ? 'Unpin' : 'Pin'}
      </Button>
      <Button size="sm" variant="danger" disabled={pending} onClick={() => run('DELETE')}>
        Remove
      </Button>
    </span>
  );
}
