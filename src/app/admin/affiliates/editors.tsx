'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { payAffiliate, saveAffiliate, setAffiliateStatus, voidSale } from '@/server/affiliates';
import type { ActionState } from '@/server/courses';
import { Button, Card, Field, FormError, FormSuccess, Input, Textarea } from '@/components/ui';
import { suggestCode } from '@/lib/affiliates';

const initial: ActionState = {};

export interface AffiliateDraft {
  id: string;
  name: string;
  email: string;
  phone: string;
  code: string;
  commissionPercent: number;
  payoutDetails: string;
  notes: string;
  userEmail: string;
}

export function AffiliateForm({ draft }: { draft: AffiliateDraft | null }) {
  const [state, action, pending] = useActionState(saveAffiliate, initial);
  const [code, setCode] = useState(draft?.code ?? '');
  const [name, setName] = useState(draft?.name ?? '');

  return (
    <form action={action} className="space-y-5">
      {draft && <input type="hidden" name="id" value={draft.id} />}
      <Card>
        <h2 className="t-heading">Who they are</h2>
        <div className="mt-4 space-y-4">
          <FormError message={state.error} />
          <FormSuccess message={state.ok ? state.message : undefined} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input
                name="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!draft && !code) setCode('');
                }}
                onBlur={() => {
                  if (!draft && !code && name.trim()) setCode(suggestCode(name));
                }}
                required
                maxLength={120}
              />
            </Field>
            <Field label="Code" hint="Goes in their link. Letters and digits.">
              <Input name="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required maxLength={24} className="font-mono" />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" defaultValue={draft?.email ?? ''} maxLength={160} />
            </Field>
            <Field label="Phone">
              <Input name="phone" type="tel" defaultValue={draft?.phone ?? ''} maxLength={20} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="t-heading">The share</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Commission" hint="Of the order after discount, before tax. Owed once the order is paid.">
            <span className="flex items-center gap-2">
              <Input name="commissionPercent" type="number" min={0} max={100} step={0.5} defaultValue={draft?.commissionPercent ?? 10} className="w-28" required />
              <span className="t-small faint">%</span>
            </span>
          </Field>
          <Field label="How they are paid" hint="A UPI id, a bank line. For the office; the partner does not see it.">
            <Input name="payoutDetails" defaultValue={draft?.payoutDetails ?? ''} maxLength={200} />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Their account here" hint="Email of an account on this site, if they have one, so they can see their own clicks and sales under Account.">
            <Input name="userEmail" type="email" defaultValue={draft?.userEmail ?? ''} maxLength={160} />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Notes">
            <Textarea name="notes" rows={2} defaultValue={draft?.notes ?? ''} maxLength={1000} />
          </Field>
        </div>
      </Card>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : draft ? 'Save' : 'Add the partner'}
      </Button>
    </form>
  );
}

export function StatusToggle({ id, status }: { id: string; status: string }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();
  return (
    <span className="flex items-center gap-2">
      {error && <span className="t-small" style={{ color: 'var(--bad)' }}>{error}</span>}
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await setAffiliateStatus(id, status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE');
            setError(r.error);
            if (!r.error) router.refresh();
          })
        }
      >
        {status === 'ACTIVE' ? 'Pause' : 'Resume'}
      </Button>
    </span>
  );
}

export function PayoutForm({ affiliateId, owedLabel }: { affiliateId: string; owedLabel: string }) {
  const [state, action, pending] = useActionState(payAffiliate, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="affiliateId" value={affiliateId} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <p className="t-small">
        Owed now: <strong>{owedLabel}</strong>. Pay them however you pay people, then record it here.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input name="payoutRef" placeholder="Transaction reference" maxLength={120} className="max-w-xs" required />
        <Button type="submit" disabled={pending}>
          {pending ? 'Recording…' : 'Mark as paid'}
        </Button>
      </div>
    </form>
  );
}

export function VoidSaleButton({ saleId }: { saleId: string }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();
  return (
    <span className="flex items-center gap-2">
      {error && <span className="t-small" style={{ color: 'var(--bad)' }}>{error}</span>}
      <button
        type="button"
        className="t-small underline"
        style={{ color: 'var(--bad)' }}
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await voidSale(saleId);
            setError(r.error);
            if (!r.error) router.refresh();
          })
        }
      >
        Void
      </button>
    </span>
  );
}
