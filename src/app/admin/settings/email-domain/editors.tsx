'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { checkEmailDomain, removeEmailDomain, saveEmailDomain } from '@/server/email-domain';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input } from '@/components/ui';

export function DomainForm({ draft }: { draft: { domain: string; fromLocal: string; fromName: string } | null }) {
  const [state, action, pending] = useActionState(saveEmailDomain, {} as ActionState);
  const [domain, setDomain] = useState(draft?.domain ?? '');
  const [local, setLocal] = useState(draft?.fromLocal ?? 'noreply');
  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Domain" hint="The one your learners know you by."><Input name="domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="academy.in" required className="font-mono" /></Field>
        <Field label="Address" hint={domain ? `Mail goes out as ${local || 'noreply'}@${domain}` : 'What comes before the @.'}><Input name="fromLocal" value={local} onChange={(e) => setLocal(e.target.value)} className="font-mono" /></Field>
        <Field label="Sender name" hint="Shown beside the address."><Input name="fromName" defaultValue={draft?.fromName ?? ''} placeholder="Medcity International Academy" /></Field>
      </div>
      {draft && draft.domain && domain !== draft.domain && <p className="t-small text-[var(--warn)]">Changing the domain mints a new key; the DNS records below will change and need adding again.</p>}
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : draft ? 'Save' : 'Set the domain'}</Button>
    </form>
  );
}

export function CheckButtons({ hasDomain }: { hasDomain: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      setNote(r.error ?? r.message ?? null);
      if (!r.error) router.refresh();
    });
  if (!hasDomain) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(checkEmailDomain)}>{pending ? 'Checking…' : 'Check DNS now'}</Button>
      <button type="button" disabled={pending} onClick={() => { if (window.confirm('Remove the domain? Mail goes out from the provider\'s address again.')) run(removeEmailDomain); }} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs text-[var(--bad)] hover:bg-[var(--surface-2)] disabled:opacity-60">Remove</button>
      {note && <span className="t-small muted">{note}</span>}
    </div>
  );
}

export function CopyValue({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}
      className="rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs hover:bg-[var(--surface-2)]"
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}
