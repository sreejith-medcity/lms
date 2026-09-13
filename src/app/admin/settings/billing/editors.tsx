'use client';

import Script from 'next/script';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestPlanChange, setCancelAtPeriodEnd, startInvoicePayment } from '@/server/billing';
import type { ActionState } from '@/server/courses';
import type { Cycle } from '@/lib/platform/billing-rules';
import { Button, Select } from '@/components/ui';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

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

export function PlanChooser({ plans, currentCode, currentCycle, canEdit }: { plans: { code: string; name: string; monthlyLabel: string; quarterlyLabel: string | null; annualLabel: string | null }[]; currentCode: string; currentCycle: string; canEdit: boolean }) {
  const { pending, note, run } = useRun();
  const [code, setCode] = useState(currentCode);
  const [cycle, setCycle] = useState<Cycle>(currentCycle as Cycle);
  const chosen = plans.find((p) => p.code === code);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((p) => (
          <label key={p.code} className={`cursor-pointer rounded-[var(--radius)] border p-3 ${code === p.code ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <input type="radio" className="sr-only" checked={code === p.code} onChange={() => setCode(p.code)} disabled={!canEdit} />
            <p className="font-medium">{p.name}{p.code === currentCode && <span className="t-micro faint ml-2">current</span>}</p>
            <p className="t-small tabular-nums">{p.monthlyLabel} monthly{p.quarterlyLabel ? ` · ${p.quarterlyLabel} quarterly` : ''}{p.annualLabel ? ` · ${p.annualLabel} a year` : ''}</p>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)} className="w-40" disabled={!canEdit}>
          <option value="MONTHLY">Monthly</option>
          {chosen?.quarterlyLabel && <option value="QUARTERLY">Quarterly</option>}
          {chosen?.annualLabel && <option value="ANNUAL">Annual</option>}
        </Select>
        {canEdit && (
          <Button size="sm" disabled={pending || (code === currentCode && cycle === currentCycle)} onClick={() => run(() => requestPlanChange(code, cycle))}>
            {pending ? 'Saving…' : 'Change from the next renewal'}
          </Button>
        )}
        {note && <span className="t-small muted">{note}</span>}
      </div>
    </div>
  );
}

export function CancelControl({ cancelAtPeriodEnd }: { cancelAtPeriodEnd: boolean }) {
  const { pending, note, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!cancelAtPeriodEnd && !window.confirm('Close the academy at the end of the paid period? Learners lose access then. You can undo this until it happens.')) return;
          run(() => setCancelAtPeriodEnd(!cancelAtPeriodEnd));
        }}
        className={`rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)] disabled:opacity-60 ${cancelAtPeriodEnd ? '' : 'text-[var(--bad)]'}`}
      >
        {cancelAtPeriodEnd ? 'Keep the academy open' : 'Close at the end of the period'}
      </button>
      {note && <span className="t-small muted">{note}</span>}
    </div>
  );
}

export function PayInvoiceButton({ invoiceId, academyName, brandColor, payerName, payerEmail }: { invoiceId: string; academyName: string; brandColor: string; payerName: string; payerEmail: string | null }) {
  const router = useRouter();
  const [stage, setStage] = useState<'idle' | 'opening' | 'verifying' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const pay = async () => {
    setStage('opening');
    setMessage(null);
    const start = await startInvoicePayment(invoiceId);
    if (!start.ok) {
      setStage('error');
      setMessage(start.error);
      return;
    }
    if (!window.Razorpay) {
      setStage('error');
      setMessage('The payment window could not load.');
      return;
    }
    const rzp = new window.Razorpay({
      key: start.keyId,
      order_id: start.gatewayOrderId,
      amount: start.amountPaise,
      currency: 'INR',
      name: 'Platform subscription',
      description: `${academyName}: ${start.invoiceNo}`,
      theme: { color: brandColor },
      prefill: { name: payerName, email: payerEmail ?? undefined },
      modal: { ondismiss: () => setStage('idle') },
      handler: async (response: Record<string, string>) => {
        setStage('verifying');
        const res = await fetch('/api/platform/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...response, invoiceId }) });
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) {
          setStage('error');
          setMessage(body?.error ?? 'We could not confirm that payment.');
          return;
        }
        setStage('done');
        router.refresh();
      },
    });
    rzp.open();
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" onLoad={() => setReady(true)} />
      <Button size="sm" disabled={!ready || stage === 'opening' || stage === 'verifying'} onClick={pay}>
        {stage === 'verifying' ? 'Confirming…' : stage === 'done' ? 'Paid' : 'Pay now'}
      </Button>
      {message && <span className="t-micro text-[var(--bad)]">{message}</span>}
    </span>
  );
}
