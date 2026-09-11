'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveSegment, recomputeSegment, deleteSegment } from '@/server/segments';
import type { ActionState } from '@/server/courses';
import { FIELDS } from '@/lib/segments';
import { Button, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

interface Draft {
  field: string;
  value: string;
}

export function NewSegment({
  courses,
  batches,
}: {
  courses: { id: string; name: string }[];
  batches: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveSegment, initial);
  const [rules, setRules] = useState<Draft[]>([{ field: 'inactive_days', value: '14' }]);

  function update(i: number, changes: Partial<Draft>) {
    setRules((all) => all.map((r, index) => (index === i ? { ...r, ...changes } : r)));
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="type" value="DYNAMIC" />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" required maxLength={120} placeholder="Slipping behind in A1" />
        </Field>
        <Field label="Match">
          <Select name="match" defaultValue="ALL">
            <option value="ALL">Every condition</option>
            <option value="ANY">Any condition</option>
          </Select>
        </Field>
      </div>

      <div className="space-y-3">
        {rules.map((rule, i) => {
          const field = FIELDS.find((f) => f.key === rule.field);
          const input = field?.input ?? 'NONE';
          const options = input === 'COURSE' ? courses : input === 'BATCH' ? batches : [];

          return (
            <div key={i} className="flex flex-wrap items-end gap-3 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3">
              <div className="min-w-56 flex-1">
                <Field label={`Condition ${i + 1}`}>
                  <Select
                    name="ruleField"
                    value={rule.field}
                    onChange={(e) => update(i, { field: e.target.value, value: '' })}
                  >
                    {FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="w-56">
                <Field label={input === 'NONE' ? 'No value needed' : 'Value'}>
                  {options.length > 0 ? (
                    <Select
                      name="ruleValue"
                      value={rule.value}
                      onChange={(e) => update(i, { value: e.target.value })}
                    >
                      <option value="">Pick one</option>
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      name="ruleValue"
                      value={rule.value}
                      disabled={input === 'NONE'}
                      type={input === 'NONE' || input === 'TEXT' ? 'text' : 'number'}
                      min={0}
                      placeholder={input === 'PERCENT' ? '50' : input === 'DAYS' ? '14' : input === 'TEXT' ? 'needs a call' : ''}
                      onChange={(e) => update(i, { value: e.target.value })}
                    />
                  )}
                </Field>
              </div>

              {rules.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRules((all) => all.filter((_, index) => index !== i))}
                >
                  Remove
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={rules.length >= 10}
          onClick={() => setRules((all) => [...all, { field: 'progress_below', value: '50' }])}
        >
          Add a condition
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Working it out…' : 'Save and count'}
        </Button>
      </div>
    </form>
  );
}

export function SegmentActions({ id, isStatic }: { id: string; isStatic: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});

  function run(work: () => Promise<ActionState>) {
    start(async () => {
      const res = await work();
      setState(res);
      if (!res.error) router.refresh();
    });
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {state.error && <span className="t-micro text-[var(--bad)]">{state.error}</span>}
      {state.ok && state.message && <span className="t-micro muted">{state.message}</span>}
      {!isStatic && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => recomputeSegment(id))}>
          Recount
        </Button>
      )}
      <button
        type="button"
        className="t-small faint hover:text-[var(--bad)]"
        disabled={pending}
        onClick={() => run(() => deleteSegment(id))}
      >
        Delete
      </button>
    </span>
  );
}
