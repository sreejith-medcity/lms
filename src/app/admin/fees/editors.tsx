'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createInstalmentPlan, markInstalmentPaid } from '@/server/money';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

export function PlanForm({ enrollments }: { enrollments: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(createInstalmentPlan, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Enrolment">
        <Select name="enrollmentId" required defaultValue="">
          <option value="" disabled>
            Choose a learner
          </option>
          {enrollments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Total fee (₹)">
          <Input name="totalRupees" type="number" min={1} step="0.01" required />
        </Field>
        <Field label="Instalments">
          <Input name="count" type="number" min={2} max={24} defaultValue={3} required />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First due">
          <Input name="firstDue" type="date" required />
        </Field>
        <Field label="Then every" hint="Days">
          <Input name="intervalDays" type="number" min={7} max={180} defaultValue={30} required />
        </Field>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Creating...' : 'Create the plan'}
      </Button>
    </form>
  );
}

export function InstalmentRow({
  instalment,
}: {
  instalment: { id: string; sequence: number; amount: string; dueDate: string; paid: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [method, setMethod] = useState('CASH');
  const [error, setError] = useState<string>();

  const due = new Date(instalment.dueDate);
  const overdue = !instalment.paid && due < new Date();

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span className="t-small faint tabular-nums">#{instalment.sequence}</span>
        <span className="text-sm font-medium tabular-nums">{instalment.amount}</span>
        <span className={`t-small ${overdue ? 'text-[var(--bad)]' : 'faint'}`}>
          due {due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {instalment.paid ? (
          <Badge tone="ok">paid</Badge>
        ) : (
          <>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="h-8 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 text-[0.8125rem]"
              aria-label="How it was paid"
            >
              <option value="CASH">Cash</option>
              <option value="BANK">Bank</option>
              <option value="CHEQUE">Cheque</option>
              <option value="UPI">UPI</option>
            </select>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await markInstalmentPaid(instalment.id, method);
                  setError(res.error);
                  if (!res.error) router.refresh();
                })
              }
            >
              {pending ? 'Saving...' : 'Mark paid'}
            </Button>
          </>
        )}
        {error && <span className="t-small text-[var(--bad)]">{error}</span>}
      </div>
    </li>
  );
}
