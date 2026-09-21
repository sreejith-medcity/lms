'use client';

import { useActionState, useState, useTransition } from 'react';
import { cancelPass, savePassPlan, sellPass, togglePassPlan, type SaleState } from '@/server/passes';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export interface PlanRow {
  id: string;
  name: string;
  classes: number;
  validityDays: number | null;
  priceRupees: number;
  productId: string | null;
  isActive: boolean;
}

export interface CourseOption {
  id: string;
  title: string;
}

export interface BatchOption {
  id: string;
  name: string;
  productId: string;
  status: string;
}

export function PlanForm({ draft, courses, onDone }: { draft: PlanRow | null; courses: CourseOption[]; onDone?: () => void }) {
  const [state, action, pending] = useActionState(savePassPlan, initial);
  return (
    <form action={action} className="space-y-4">
      {draft && <input type="hidden" name="id" value={draft.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="As the counter says it: 'Ten spoken English classes'.">
          <Input name="name" defaultValue={draft?.name ?? ''} required maxLength={80} />
        </Field>
        <Field label="Course" hint="Only this course's batches can be picked when selling it. Leave open for any batch.">
          <Select name="productId" defaultValue={draft?.productId ?? ''}>
            <option value="">Any course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Classes on the pass">
          <Input name="classes" type="number" min={1} max={500} defaultValue={draft?.classes ?? 10} required />
        </Field>
        <Field label="Valid for (days)" hint="Blank means it never lapses.">
          <Input name="validityDays" type="number" min={1} max={3650} defaultValue={draft?.validityDays ?? 90} />
        </Field>
        <Field label="Price (rupees)">
          <Input name="priceRupees" type="number" min={0} step="1" defaultValue={draft?.priceRupees ?? 0} required />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : draft ? 'Save plan' : 'Add plan'}
        </Button>
        {onDone && (
          <button type="button" className="t-small faint hover:underline" onClick={onDone}>
            Close
          </button>
        )}
      </div>
    </form>
  );
}

export function PlanToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [busy, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => start(async () => setState(await togglePassPlan(id, !isActive)))}>
        {busy ? '...' : isActive ? 'Take off sale' : 'Put on sale'}
      </Button>
      {state.error && <span className="t-small text-[var(--bad)]">{state.error}</span>}
    </span>
  );
}

export function SaleForm({ plans, batches, prefill }: { plans: PlanRow[]; batches: BatchOption[]; prefill?: string }) {
  const [state, action, pending] = useActionState(sellPass, initial as SaleState);
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const plan = plans.find((p) => p.id === planId) ?? null;
  const eligible = batches.filter((b) => !plan?.productId || b.productId === plan.productId);
  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      {state.ok && state.receiptNo && (
        <p className="t-small">
          <a href={`/learn/receipts/${state.receiptNo}`} className="underline" target="_blank" rel="noreferrer">
            Print receipt {state.receiptNo}
          </a>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Learner" hint="Scan their card into this box, or type the registration number, email or mobile.">
          <Input name="learner" defaultValue={prefill ?? ''} required autoComplete="off" autoFocus={!prefill} />
        </Field>
        <Field label="Pass">
          <Select name="planId" value={planId} onChange={(e) => setPlanId(e.target.value)} required>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}: {p.classes} classes{p.validityDays ? `, ${p.validityDays} days` : ''}, Rs {p.priceRupees.toLocaleString('en-IN')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Batch they will attend" hint={eligible.length === 0 ? 'No live batch for this pass’s course. Create one under Batches first.' : undefined}>
          <Select name="batchId" required defaultValue="">
            <option value="" disabled>
              Pick a batch
            </option>
            {eligible.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.status.toLowerCase()})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount received (rupees)" hint="Prefilled from the plan; change it if a concession was given.">
          <Input key={planId} name="amountRupees" type="number" min={0} step="1" defaultValue={plan?.priceRupees ?? 0} required />
        </Field>
        <Field label="Paid by">
          <Select name="method" defaultValue="CASH">
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
            <option value="BANK">Bank transfer</option>
            <option value="CHEQUE">Cheque</option>
          </Select>
        </Field>
        <Field label="Reference" hint="The UPI or transfer id, if any.">
          <Input name="reference" maxLength={80} />
        </Field>
      </div>
      <Field label="Note">
        <Textarea name="note" rows={2} maxLength={300} />
      </Field>
      <Button type="submit" disabled={pending || plans.length === 0}>
        {pending ? 'Selling...' : 'Sell the pass'}
      </Button>
    </form>
  );
}

export function CancelPass({ id }: { id: string }) {
  const [busy, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<ActionState>({});
  if (state.ok) return <span className="t-small faint">cancelled</span>;
  if (!asking)
    return (
      <button type="button" className="t-small faint hover:underline" onClick={() => setAsking(true)}>
        Cancel
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why" className="w-40" maxLength={300} />
      <Button size="sm" disabled={busy || !reason.trim()} onClick={() => start(async () => setState(await cancelPass(id, reason)))}>
        {busy ? '...' : 'Confirm'}
      </Button>
      <button type="button" className="t-small faint hover:underline" onClick={() => setAsking(false)}>
        Keep
      </button>
      {state.error && <span className="t-small text-[var(--bad)]">{state.error}</span>}
    </span>
  );
}
