'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { anonymiseLearner, refuseDeletion } from '@/server/data-rights';
import type { ActionState } from '@/server/courses';
import { Button, FormError, FormSuccess, Input, Textarea } from '@/components/ui';
import { NOTE_MAX } from '@/lib/data-rights';

const initial: ActionState = {};

/**
 * Two ways to close a request, each behind its own click so neither is
 * pressed by accident. Forgetting asks for the word typed out, because it
 * is the one action on the admin side with no undo.
 */
export function CloseForms({
  requestId,
  learnerName,
  canRefuse,
  canForget,
}: {
  requestId: string;
  learnerName: string;
  canRefuse: boolean;
  canForget: boolean;
}) {
  const [mode, setMode] = useState<'idle' | 'refuse' | 'forget'>('idle');
  const [refuseState, refuseAction, refusing] = useActionState(refuseDeletion, initial);
  const [forgetState, forgetAction, forgetting] = useActionState(anonymiseLearner, initial);
  const router = useRouter();

  if (refuseState.ok || forgetState.ok) {
    setTimeout(() => router.refresh(), 0);
    return <FormSuccess message={refuseState.message ?? forgetState.message} />;
  }

  if (!canRefuse && !canForget) return null;

  return (
    <div className="mt-3">
      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {canForget && (
            <Button size="sm" variant="danger" onClick={() => setMode('forget')}>
              Forget this learner
            </Button>
          )}
          {canRefuse && (
            <Button size="sm" variant="secondary" onClick={() => setMode('refuse')}>
              Do not go ahead
            </Button>
          )}
        </div>
      )}

      {mode === 'refuse' && (
        <form action={refuseAction} className="space-y-2 rounded-[var(--radius-sm)] border p-3">
          <input type="hidden" name="requestId" value={requestId} />
          <p className="t-small font-semibold">Tell {learnerName} why</p>
          <FormError message={refuseState.error} />
          <Textarea name="note" rows={3} maxLength={NOTE_MAX} required placeholder="For example: there are unpaid instalments on the account; please settle them or contact the office, and ask again." />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={refusing}>
              {refusing ? 'Sending…' : 'Send and close'}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === 'forget' && (
        <form action={forgetAction} className="space-y-2 rounded-[var(--radius-sm)] border p-3" style={{ borderColor: 'var(--bad)' }}>
          <input type="hidden" name="requestId" value={requestId} />
          <p className="t-small font-semibold">This cannot be undone</p>
          <p className="t-small muted">
            {learnerName}&rsquo;s name, contact details, sign-ins, notes, profile and documents are removed and the
            account closed. Orders, invoices, marks and certificates stay on record without a way to reach the
            person. They are told first, at the address on file.
          </p>
          <FormError message={forgetState.error} />
          <Textarea name="note" rows={2} maxLength={NOTE_MAX} placeholder="A line for the learner, optional." />
          <Input name="confirm" placeholder="Type FORGET to confirm" autoComplete="off" required />
          <div className="flex gap-2">
            <Button size="sm" type="submit" variant="danger" disabled={forgetting}>
              {forgetting ? 'Working…' : 'Forget them'}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
