'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestDeletion, withdrawDeletion } from '@/server/data-rights';
import type { ActionState } from '@/server/courses';
import { Button, Checkbox, FormError, FormSuccess, Textarea } from '@/components/ui';
import { REASON_MAX } from '@/lib/data-rights';

const initial: ActionState = {};

export function DeletionForm({ open }: { open: { askedAt: string } | null }) {
  const [state, action, pending] = useActionState(requestDeletion, initial);
  const [busy, start] = useTransition();
  const [problem, setProblem] = useState<string>();
  const [show, setShow] = useState(false);
  const router = useRouter();

  if (state.ok) setTimeout(() => router.refresh(), 0);

  if (open) {
    return (
      <div className="rounded-[var(--radius-sm)] border-l-4 bg-[var(--surface-2)] p-3" style={{ borderColor: 'var(--warn)' }}>
        <p className="t-small font-semibold">Asked on {open.askedAt}. The academy is looking at it.</p>
        <p className="t-small muted mt-1">Nothing changes until they act. You can withdraw the request until then.</p>
        <div className="mt-3 flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await withdrawDeletion();
                setProblem(r.error);
                if (!r.error) router.refresh();
              })
            }
          >
            Withdraw the request
          </Button>
          {problem && <span className="t-small" style={{ color: 'var(--bad)' }}>{problem}</span>}
        </div>
      </div>
    );
  }

  if (!show) {
    return (
      <Button variant="secondary" onClick={() => setShow(true)}>
        Ask to close my account
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <Textarea name="reason" rows={3} maxLength={REASON_MAX} placeholder="Why, if you would like to say. Optional." />
      <Checkbox
        name="sure"
        label="I understand my account will be closed and my details removed, and that this cannot be undone."
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? 'Sending…' : 'Send the request'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setShow(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
