'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePricingTemplate, savePricingTemplate, setPricingTemplateActive } from '@/server/pricing-templates';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';
import { parseShares, sharesProblem } from '@/lib/pricing-templates';

const initial: ActionState = {};

export interface TemplateDraft {
  id: string;
  name: string;
  planType: string;
  instalmentCount: number;
  gapDays: number;
  shares: number[];
  validityDays: number | null;
  invoiceAnchor: string;
  notes: string;
}

export function TemplateForm({ draft }: { draft: TemplateDraft | null }) {
  const [state, action, pending] = useActionState(savePricingTemplate, initial);
  const [planType, setPlanType] = useState(draft?.planType ?? 'INSTALMENT');
  const [count, setCount] = useState(draft?.instalmentCount ?? 3);
  const [shares, setShares] = useState(draft?.shares.join(', ') ?? '');
  const sharesIssue = sharesProblem(parseShares(shares), count);

  return (
    <form action={action} className="space-y-4">
      {draft && <input type="hidden" name="id" value={draft.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="What the office picks from the list: 'Standard three parts', 'Corporate, paid up front'.">
          <Input name="name" defaultValue={draft?.name ?? ''} required maxLength={80} />
        </Field>
        <Field label="How it is paid">
          <Select name="planType" value={planType} onChange={(e) => setPlanType(e.target.value)}>
            <option value="ONE_TIME">In full, once</option>
            <option value="INSTALMENT">In instalments</option>
            <option value="SUBSCRIPTION">As a subscription</option>
          </Select>
        </Field>
      </div>

      {planType === 'INSTALMENT' && (
        <div className="rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Number of parts">
              <Input name="instalmentCount" type="number" min={2} max={24} value={count} onChange={(e) => setCount(Math.max(2, Number(e.target.value) || 2))} />
            </Field>
            <Field label="Days apart">
              <Input name="gapDays" type="number" min={1} max={365} defaultValue={draft?.gapDays ?? 30} />
            </Field>
            <Field label="Counted from">
              <Select name="invoiceAnchor" defaultValue={draft?.invoiceAnchor ?? 'CLASS_COMMENCEMENT'}>
                <option value="CLASS_COMMENCEMENT">The batch start date</option>
                <option value="ENROLLMENT">The day they enrol</option>
              </Select>
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Shares" hint="Percent per part, adding to 100, like 40, 30, 30. Blank means equal parts." error={sharesIssue ?? undefined}>
              <Input name="shares" value={shares} onChange={(e) => setShares(e.target.value)} placeholder="40, 30, 30" maxLength={120} />
            </Field>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Validity in days" hint="Blank means access never expires. 365 for a year.">
          <Input name="validityDays" type="number" min={0} step={1} defaultValue={draft?.validityDays ?? ''} />
        </Field>
        <Field label="Notes" hint="For the office. Who this shape is for.">
          <Textarea name="notes" rows={2} defaultValue={draft?.notes ?? ''} maxLength={500} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || Boolean(sharesIssue)}>{pending ? 'Saving…' : draft ? 'Save changes' : 'Add template'}</Button>
        {draft && (
          <a href="/admin/pricing-templates" className="t-small muted hover:underline">
            Cancel
          </a>
        )}
      </div>
    </form>
  );
}

export function TemplateActions({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      setNote(r.error ?? r.message ?? null);
      if (!r.error) router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`/admin/pricing-templates?edit=${id}`} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)]">
        Edit
      </a>
      <button type="button" disabled={pending} onClick={() => run(() => setPricingTemplateActive(id, !isActive))} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)] disabled:opacity-60">
        {isActive ? 'Retire' : 'Bring back'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('Remove this template? Plans already made from it are not touched.')) return;
          run(() => deletePricingTemplate(id));
        }}
        className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs text-[var(--bad)] hover:bg-[var(--surface-2)] disabled:opacity-60"
      >
        Remove
      </button>
      {note && <span className="t-micro muted">{note}</span>}
    </div>
  );
}
