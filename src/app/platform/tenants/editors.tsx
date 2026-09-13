'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addTenantDomain, changePlanNow, createTenantByHand, extendTrial, markTenantInvoicePaid, runBillingNow, setDomainState, setTenantStatus, voidTenantInvoice } from '@/server/platform-tenants';
import type { ActionState } from '@/server/courses';
import type { Cycle } from '@/lib/platform/billing-rules';
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};
const btn = 'rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)] disabled:opacity-60';

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      setNote(r.error ?? r.message ?? null);
      if (!r.error) router.refresh();
    });
  return { pending, note, run };
}

export function RunBillingButton() {
  const { pending, note, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} onClick={() => run(runBillingNow)} className={btn}>{pending ? 'Running…' : 'Run billing now'}</button>
      {note && <span className="t-micro muted max-w-xs">{note}</span>}
    </span>
  );
}

export function StandingControls({ id, status }: { id: string; status: string }) {
  const { pending, note, run } = useRun();
  const [days, setDays] = useState(14);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status !== 'ACTIVE' && <button type="button" disabled={pending} onClick={() => run(() => setTenantStatus(id, 'ACTIVE'))} className={btn}>Set active</button>}
        {status !== 'SUSPENDED' && status !== 'CANCELLED' && (
          <button type="button" disabled={pending} onClick={() => { const why = window.prompt('Why is it being paused? The academy sees this.'); if (why !== null) run(() => setTenantStatus(id, 'SUSPENDED', why)); }} className={`${btn} text-[var(--bad)]`}>Pause</button>
        )}
        {status !== 'CANCELLED' && (
          <button type="button" disabled={pending} onClick={() => { if (window.confirm('Cancel this academy? It stops working for everyone on it.')) run(() => setTenantStatus(id, 'CANCELLED')); }} className={`${btn} text-[var(--bad)]`}>Cancel</button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} className="w-20" />
        <button type="button" disabled={pending} onClick={() => run(() => extendTrial(id, days))} className={btn}>Extend trial by {days} days</button>
      </div>
      {note && <p className="t-micro muted">{note}</p>}
    </div>
  );
}

export function PlanControls({ id, plans, currentPlanId, currentCycle }: { id: string; plans: { id: string; name: string }[]; currentPlanId: string; currentCycle: string }) {
  const { pending, note, run } = useRun();
  const [planId, setPlanId] = useState(currentPlanId);
  const [cycle, setCycle] = useState<Cycle>(currentCycle as Cycle);
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Select value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)}>
          <option value="MONTHLY">Monthly</option>
          <option value="QUARTERLY">Quarterly</option>
          <option value="ANNUAL">Annual</option>
        </Select>
      </div>
      <button type="button" disabled={pending} onClick={() => { if (window.confirm('Change the plan now? A new period starts today and is invoiced.')) run(() => changePlanNow(id, planId, cycle)); }} className={btn}>Change plan now</button>
      {note && <p className="t-micro muted">{note}</p>}
    </div>
  );
}

export function DomainControls({ id, domains }: { id: string; domains: { hostname: string; isPrimary: boolean; isCustom: boolean; sslStatus: string }[] }) {
  const { pending, note, run } = useRun();
  const [hostname, setHostname] = useState('');
  return (
    <div className="space-y-3">
      <ul className="divide-y">
        {domains.map((d) => (
          <li key={d.hostname} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <span className="font-mono text-sm">{d.hostname}</span>
              <span className="t-micro faint ml-2">{d.isPrimary ? 'primary · ' : ''}{d.isCustom ? 'custom' : 'platform'} · SSL {d.sslStatus.toLowerCase()}</span>
            </div>
            <span className="flex gap-1">
              {!d.isPrimary && <button type="button" disabled={pending} onClick={() => run(() => setDomainState(id, d.hostname, 'PRIMARY'))} className={btn}>Make primary</button>}
              {d.sslStatus !== 'ISSUED' && <button type="button" disabled={pending} onClick={() => run(() => setDomainState(id, d.hostname, 'ISSUED'))} className={btn}>Mark SSL issued</button>}
              {!d.isPrimary && <button type="button" disabled={pending} onClick={() => { if (window.confirm(`Remove ${d.hostname}?`)) run(() => setDomainState(id, d.hostname, 'REMOVE')); }} className={`${btn} text-[var(--bad)]`}>Remove</button>}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="learn.theiracademy.com" className="max-w-xs font-mono" />
        <button type="button" disabled={pending || !hostname} onClick={() => run(async () => { const r = await addTenantDomain(id, hostname); if (!r.error) setHostname(''); return r; })} className={btn}>Add custom domain</button>
      </div>
      {note && <p className="t-micro muted">{note}</p>}
    </div>
  );
}

export function InvoiceControls({ invoiceId, status }: { invoiceId: string; status: string }) {
  const { pending, note, run } = useRun();
  if (status === 'PAID' || status === 'VOID') return null;
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} onClick={() => { const ref = window.prompt('Reference for the payment (UTR, cheque, "waived")'); if (ref !== null) run(() => markTenantInvoicePaid(invoiceId, ref)); }} className={btn}>Mark paid</button>
      <button type="button" disabled={pending} onClick={() => { if (window.confirm('Void this invoice?')) run(() => voidTenantInvoice(invoiceId)); }} className={`${btn} text-[var(--bad)]`}>Void</button>
      {note && <span className="t-micro muted">{note}</span>}
    </span>
  );
}

export function NewTenantForm({ plans }: { plans: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createTenantByHand, initial);
  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Academy name"><Input name="academyName" required /></Field>
        <Field label="Web address (slug)"><Input name="slug" required className="font-mono" /></Field>
        <Field label="Owner name"><Input name="ownerName" required /></Field>
        <Field label="Owner mobile"><Input name="phone" required /></Field>
        <Field label="Owner email"><Input name="email" type="email" required /></Field>
        <Field label="Owner password" hint="Tell them to change it once in."><Input name="password" type="password" required minLength={8} /></Field>
        <Field label="Plan">
          <Select name="planCode" defaultValue={plans[0]?.code ?? ''}>
            {plans.map((p) => (
              <option key={p.code} value={p.code}>{p.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Checkbox name="active" label="Active from day one, not a trial" />
      <Button type="submit" disabled={pending}>{pending ? 'Setting up…' : 'Create the academy'}</Button>
    </form>
  );
}
