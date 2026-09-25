'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';
import type { ActionState } from '@/server/courses';
import { createPackAction, setPackPriceAction, setPackStatusAction } from '@/server/tests-admin';

const initial: ActionState = {};

export function PackForm({ targets }: { targets: { value: string; label: string }[] }) {
  const router = useRouter();
  const [unlimited, setUnlimited] = useState(false);
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await createPackAction(prev, fd);
    if (r.ok) router.refresh();
    return r;
  }, initial);
  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.message} />
      <Field label="Test">
        <Select name="target" required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Papers">
          <Input name="tests" type="number" min={1} max={100} defaultValue={5} disabled={unlimited} />
        </Field>
        <Field label="Valid for (days)" hint="From the day of purchase. Empty for no end.">
          <Input name="days" type="number" min={1} max={730} defaultValue={90} />
        </Field>
      </div>
      <Checkbox name="unlimited" label="Unlimited papers for the validity" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Price (₹)" hint="Before tax, as every price here.">
          <Input name="price" inputMode="decimal" required placeholder="999" />
        </Field>
        <Field label="Crossed-out price (₹)" hint="Optional.">
          <Input name="mrp" inputMode="decimal" />
        </Field>
      </div>
      <Field label="Title" hint="Optional; made from the test and the number of papers otherwise.">
        <Input name="title" maxLength={120} />
      </Field>
      <Field label="One line for the card">
        <Textarea name="description" rows={2} maxLength={400} />
      </Field>
      <Checkbox name="publish" label="Put it on sale now" defaultChecked />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Create the pack'}
      </Button>
    </form>
  );
}

export function PackActions({ id, status, rupees }: { id: string; status: string; rupees: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [price, setPrice] = useState(rupees == null ? '' : String(rupees));
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      setError(r.error);
      if (!r.error) router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="w-24" aria-label="Price in rupees" />
      <Button size="sm" variant="secondary" disabled={pending || price === String(rupees ?? '')} onClick={() => run(() => setPackPriceAction(id, Number(price)))}>
        Save price
      </Button>
      {status === 'PUBLISHED' ? (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setPackStatusAction(id, 'DRAFT'))}>
          Take off sale
        </Button>
      ) : (
        <Button size="sm" disabled={pending} onClick={() => run(() => setPackStatusAction(id, 'PUBLISHED'))}>
          Put on sale
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setPackStatusAction(id, 'ARCHIVED'))}>
        Archive
      </Button>
      {error && <span className="t-small text-[var(--bad)]">{error}</span>}
    </div>
  );
}
