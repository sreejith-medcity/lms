'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordCheque, settleCheque } from '@/server/cheques';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

export function ChequeActions({ chequeId }: { chequeId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [bouncing, setBouncing] = useState(false);
  const [remark, setRemark] = useState('');

  function run(outcome: 'CLEARED' | 'BOUNCED') {
    start(async () => {
      const res = await settleCheque(chequeId, outcome, remark);
      setError(res.error);
      if (!res.error) {
        setBouncing(false);
        setRemark('');
        router.refresh();
      }
    });
  }

  if (bouncing) {
    return (
      <span className="flex items-center justify-end gap-2">
        <Input
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Reason"
          aria-label="Why it bounced"
          className="h-8 w-40 py-1"
        />
        <Button size="sm" variant="danger" disabled={pending} onClick={() => run('BOUNCED')}>
          Confirm
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setBouncing(false)}>
          Cancel
        </Button>
      </span>
    );
  }

  return (
    <span className="flex items-center justify-end gap-2">
      {error && <span className="t-micro text-[var(--bad)]">{error}</span>}
      <Button size="sm" disabled={pending} onClick={() => run('CLEARED')}>
        Cleared
      </Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => setBouncing(true)}>
        Bounced
      </Button>
    </span>
  );
}

export function NewCheque({
  learners,
  currency,
  defaultDate,
}: {
  learners: { id: string; name: string; email: string | null }[];
  currency: string;
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState(recordCheque, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Student name" hint="As written on the cheque.">
          <Input name="studentName" required maxLength={160} />
        </Field>
        <Field label="Paid by" hint="Optional. A parent, usually.">
          <Input name="parentName" maxLength={160} />
        </Field>
        <Field label="Bank">
          <Input name="bankName" required maxLength={120} placeholder="Federal Bank" />
        </Field>
        <Field label="Cheque number">
          <Input name="chequeNo" required maxLength={40} className="font-mono" />
        </Field>
        <Field label="Date on the cheque">
          <Input name="chequeDate" type="date" required defaultValue={defaultDate} />
        </Field>
        <Field label={`Amount (${currency})`}>
          <Input name="amountRupees" type="number" min={1} step="0.01" required />
        </Field>
        <Field label="Learner account" hint="Optional, but worth linking.">
          <Select name="userId" defaultValue="">
            <option value="">Not linked</option>
            {learners.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.email ? ` · ${l.email}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" hint="Optional.">
          <Input name="remark" maxLength={300} />
        </Field>
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Button type="submit" disabled={pending}>
        {pending ? 'Recording…' : 'Record cheque'}
      </Button>
    </form>
  );
}
