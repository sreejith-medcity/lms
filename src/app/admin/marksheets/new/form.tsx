'use client';

import { useActionState, useState } from 'react';
import { createMarkSheet } from '@/server/mark-sheets';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, Input, Select } from '@/components/ui';

interface BatchOption {
  id: string;
  label: string;
  categories: string[];
  skills: string[];
  passPercent: number | null;
}

const initial: ActionState = {};

export function NewSheetForm({ batches, preselected }: { batches: BatchOption[]; preselected: string }) {
  const [state, action, pending] = useActionState(createMarkSheet, initial);
  const [batchId, setBatchId] = useState(preselected && batches.some((b) => b.id === preselected) ? preselected : (batches[0]?.id ?? ''));
  const batch = batches.find((b) => b.id === batchId);

  if (batches.length === 0) return <p className="t-small muted">No batch is assigned to you, so there is nothing to enter marks for.</p>;

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <Field label="Batch">
        <Select name="batchId" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title" hint="As the parent will read it">
        <Input name="title" required maxLength={160} placeholder="Unit 3 class test" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind of test">
          <Select name="category" defaultValue={batch?.categories[0] ?? ''}>
            {(batch?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Skill" hint={batch?.skills.length ? 'From the program' : 'The program lists none'}>
          {batch?.skills.length ? (
            <Select name="skill" defaultValue="">
              <option value="">Whole test</option>
              {batch.skills.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          ) : (
            <Input name="skill" maxLength={60} placeholder="Optional" />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Test date">
          <Input type="date" name="testDate" required defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Maximum marks">
          <Input type="number" name="maxMarks" inputMode="decimal" min={1} max={10000} step="0.5" required defaultValue={100} />
        </Field>
        <Field label="Pass mark %" hint={batch?.passPercent != null ? `Program says ${batch.passPercent}%` : 'Blank: the grading scale decides'}>
          <Input type="number" name="passPercent" inputMode="numeric" min={0} max={100} placeholder={batch?.passPercent != null ? String(batch.passPercent) : ''} />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create and enter marks'}
      </Button>
    </form>
  );
}
