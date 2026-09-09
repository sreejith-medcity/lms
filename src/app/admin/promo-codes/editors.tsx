'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { savePromoCode, setPromoActive, deletePromoCode } from '@/server/promo';
import type { ActionState } from '@/server/courses';
import { discountFor } from '@/lib/promo';
import { formatMoney } from '@/lib/money';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
} from '@/components/ui';

const initial: ActionState = {};

export function PromoForm({
  products,
  currency,
}: {
  products: { id: string; title: string }[];
  currency: string;
}) {
  const [state, action, pending] = useActionState(savePromoCode, initial);
  const [type, setType] = useState('PERCENT');
  const [value, setValue] = useState(10);
  const [cap, setCap] = useState(0);
  const [usage, setUsage] = useState('MULTIPLE');
  const [scoped, setScoped] = useState<string[]>([]);

  // What the code takes off a sample order, so nobody has to trust the wording.
  const sample = 1000000; // ten thousand rupees
  const preview = discountFor(
    {
      discountType: type,
      discountValue: value,
      maxDiscountPaise: cap > 0 ? cap * 100 : null,
      minOrderPaise: null,
    },
    sample,
  );

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Code" hint="Upper case, no spaces.">
          <Input name="code" placeholder="ONAM25" required maxLength={32} className="font-mono" />
        </Field>

        <Field label="Kind">
          <Select name="discountType" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="PERCENT">A percentage off</option>
            <option value="FLAT">A flat amount off</option>
          </Select>
        </Field>

        <Field label={type === 'PERCENT' ? 'Percent off' : `Amount off (${currency})`}>
          <Input
            name="discountValue"
            type="number"
            min={0.01}
            step={type === 'PERCENT' ? 1 : 0.01}
            max={type === 'PERCENT' ? 100 : undefined}
            required
            value={value}
            onChange={(e) => setValue(Number(e.target.value) || 0)}
          />
        </Field>

        <Field
          label={`Most it can take off (${currency})`}
          hint={type === 'PERCENT' ? 'Zero for no ceiling.' : 'Only used for a percentage.'}
        >
          <Input
            name="maxDiscountRupees"
            type="number"
            min={0}
            step={1}
            disabled={type !== 'PERCENT'}
            value={cap}
            onChange={(e) => setCap(Number(e.target.value) || 0)}
          />
        </Field>

        <Field label={`Smallest order it works on (${currency})`} hint="Zero for any order.">
          <Input name="minOrderRupees" type="number" min={0} step={1} defaultValue={0} />
        </Field>

        <Field label="How often it can be claimed">
          <Select name="usageType" value={usage} onChange={(e) => setUsage(e.target.value)}>
            <option value="MULTIPLE">By many people</option>
            <option value="SINGLE">Once, by one person</option>
          </Select>
        </Field>

        <Field label="Total claims allowed" hint="Zero for no limit.">
          <Input
            name="maxRedemptions"
            type="number"
            min={0}
            step={1}
            defaultValue={0}
            disabled={usage === 'SINGLE'}
          />
        </Field>

        <Field label="Claims per person">
          <Input
            name="perUserLimit"
            type="number"
            min={1}
            max={50}
            defaultValue={1}
            disabled={usage === 'SINGLE'}
          />
        </Field>

        <Field label="Live from" hint="Blank means straight away.">
          <Input name="startsAt" type="date" />
        </Field>

        <Field label="Live until" hint="Blank means no end.">
          <Input name="endsAt" type="date" />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Description" hint="For your own team; learners never see it.">
            <Input name="description" maxLength={200} placeholder="Onam campaign, socials only" />
          </Field>
        </div>
      </div>

      <div>
        <p className="t-small font-medium">Which courses</p>
        <p className="t-small faint">Tick none and it works on everything.</p>
        <div className="mt-2 grid max-h-52 gap-2 overflow-y-auto rounded-[var(--radius-sm)] border p-3 sm:grid-cols-2">
          {products.length === 0 && <p className="t-small faint">No courses yet.</p>}
          {products.map((p) => (
            <Checkbox
              key={p.id}
              name="productIds"
              value={p.id}
              label={p.title}
              checked={scoped.includes(p.id)}
              onChange={(e) =>
                setScoped(
                  e.target.checked ? [...scoped, p.id] : scoped.filter((id) => id !== p.id),
                )
              }
            />
          ))}
        </div>
      </div>

      <p className="t-small muted">
        On a {formatMoney(sample, currency)} order this takes off{' '}
        <strong>{formatMoney(preview, currency)}</strong>.
      </p>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save code'}
      </Button>
    </form>
  );
}

export function PromoState({
  id,
  isActive,
  used,
}: {
  id: string;
  isActive: boolean;
  used: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        title={isActive ? 'Stop accepting this code' : 'Accept this code again'}
        onClick={() =>
          start(async () => {
            const res = await setPromoActive(id, !isActive);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        <Badge tone={isActive ? 'ok' : 'neutral'}>{isActive ? 'on' : 'off'}</Badge>
      </button>
      {!used && (
        <button
          type="button"
          className="t-micro faint hover:text-[var(--bad)]"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await deletePromoCode(id);
              setError(res.error);
              if (!res.error) router.refresh();
            })
          }
        >
          delete
        </button>
      )}
      {error && <span className="t-micro text-[var(--bad)]">{error}</span>}
    </span>
  );
}
