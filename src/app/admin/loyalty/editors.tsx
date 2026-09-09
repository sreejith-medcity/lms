'use client';

import { useActionState, useState } from 'react';
import { saveLoyaltyConfig, adjustWallet } from '@/server/wallet';
import type { ActionState } from '@/server/courses';
import type { Loyalty } from '@/lib/wallet';
import {
  Button,
  Checkbox,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
} from '@/components/ui';

const initial: ActionState = {};

export function LoyaltyForm({
  config,
  currency,
  canEdit,
}: {
  config: Loyalty;
  currency: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveLoyaltyConfig, initial);
  const [rate, setRate] = useState(config.pointToCurrencyPaise);
  const [ceiling, setCeiling] = useState(config.maxRedeemablePercent);

  const money = (paise: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
      paise / 100,
    );

  return (
    <form action={action} className="space-y-4">
      <Checkbox
        name="enabled"
        label="Points are on"
        hint="Off means nothing is earned and nothing can be spent. Existing balances are kept."
        defaultChecked={config.enabled}
        disabled={!canEdit}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="One point is worth" hint={`Currently ${money(rate)}.`}>
          <Input
            name="pointToCurrencyPaise"
            type="number"
            min={1}
            max={100000}
            value={rate}
            disabled={!canEdit}
            onChange={(e) => setRate(Number(e.target.value) || 1)}
          />
        </Field>

        <Field label="Most of an order points may cover" hint="As a percentage. Keep it below 100.">
          <Input
            name="maxRedeemablePercent"
            type="number"
            min={0}
            max={99}
            step="0.5"
            value={ceiling}
            disabled={!canEdit}
            onChange={(e) => setCeiling(Number(e.target.value) || 0)}
          />
        </Field>

        <Field label="Most points one wallet may hold" hint="Zero for no ceiling.">
          <Input
            name="maxCreditAllowed"
            type="number"
            min={0}
            defaultValue={config.maxCreditAllowed}
            disabled={!canEdit}
          />
        </Field>

        <Field label="Given for signing up">
          <Input
            name="normalSignupCredit"
            type="number"
            min={0}
            defaultValue={config.normalSignupCredit}
            disabled={!canEdit}
          />
        </Field>

        <Field label="Given for joining with a code">
          <Input
            name="referralSignupCredit"
            type="number"
            min={0}
            defaultValue={config.referralSignupCredit}
            disabled={!canEdit}
          />
        </Field>

        <Field label="Given to the referrer when someone joins">
          <Input
            name="referrerCredit"
            type="number"
            min={0}
            defaultValue={config.referrerCredit}
            disabled={!canEdit}
          />
        </Field>

        <Field
          label="Given to the referrer when they buy"
          hint="Paid once, on their first purchase."
        >
          <Input
            name="referralPurchaseCredit"
            type="number"
            min={0}
            defaultValue={config.referralPurchaseCredit}
            disabled={!canEdit}
          />
        </Field>
      </div>

      <p className="t-small muted">
        On a {money(1000000)} order, points could cover at most{' '}
        <strong>{money(Math.floor((1000000 * ceiling) / 100))}</strong>.
      </p>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      {canEdit && (
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      )}
    </form>
  );
}

export function AdjustForm({ learners }: { learners: { id: string; name: string; email: string | null }[] }) {
  const [state, action, pending] = useActionState(adjustWallet, initial);

  return (
    <form action={action} className="space-y-4">
      <Field label="Learner">
        <Select name="userId" required defaultValue="">
          <option value="">Pick one</option>
          {learners.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.email ? ` · ${l.email}` : ''}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
        <Field label="Points" hint="Negative to take away.">
          <Input name="points" type="number" required step={1} />
        </Field>
        <Field label="Why">
          <Input name="note" required maxLength={200} placeholder="Goodwill after the class was moved" />
        </Field>
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Button type="submit" disabled={pending}>
        {pending ? 'Applying…' : 'Apply'}
      </Button>
    </form>
  );
}
