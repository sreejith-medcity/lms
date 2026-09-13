'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignTicketToMe, replyAsStaff, setTicketPriority, setTicketStatus } from '@/server/help-desk';
import type { ActionState } from '@/server/courses';
import type { HelpStatus } from '@/lib/help-desk';
import { Button, Checkbox, FormError, FormSuccess, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function StaffReplyForm({ ticketId, uploads }: { ticketId: string; uploads: boolean }) {
  const [state, action, pending] = useActionState(replyAsStaff, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);
  return (
    <form action={action} className="space-y-3" encType="multipart/form-data" key={state.ok ? 'sent' : 'draft'}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <Textarea name="body" rows={4} maxLength={5000} placeholder="Write to the learner. They get it by email and in the portal." required />
      {uploads && <input type="file" name="files" multiple accept="image/*,.pdf" className="t-small block" />}
      <Checkbox name="resolve" label="This resolves it" hint="The learner can still write back, which reopens it." />
      <Button type="submit" size="sm" disabled={pending}>{pending ? 'Sending…' : 'Send reply'}</Button>
    </form>
  );
}

export function TicketControls({ id, status, priority, mine }: { id: string; status: string; priority: string; mine: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      setNote(r.error ?? r.message ?? null);
      if (!r.error) router.refresh();
    });
  const btn = 'rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)] disabled:opacity-60';
  const to = (s: HelpStatus) => run(() => setTicketStatus(id, s));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!mine && <button type="button" disabled={pending} onClick={() => run(() => assignTicketToMe(id))} className={btn}>Take it</button>}
      {status !== 'OPEN' && <button type="button" disabled={pending} onClick={() => to('OPEN')} className={btn}>Reopen</button>}
      {status === 'OPEN' && <button type="button" disabled={pending} onClick={() => to('WAITING_ON_LEARNER')} className={btn}>Waiting on learner</button>}
      {status !== 'RESOLVED' && status !== 'CLOSED' && <button type="button" disabled={pending} onClick={() => to('RESOLVED')} className={btn}>Resolve without replying</button>}
      {status !== 'CLOSED' && <button type="button" disabled={pending} onClick={() => to('CLOSED')} className={btn}>Close</button>}
      <button type="button" disabled={pending} onClick={() => run(() => setTicketPriority(id, priority !== 'HIGH'))} className={`${btn} ${priority === 'HIGH' ? 'text-[var(--bad)]' : ''}`}>
        {priority === 'HIGH' ? 'Urgent, unmark' : 'Mark urgent'}
      </button>
      {note && <span className="t-micro muted">{note}</span>}
    </div>
  );
}
