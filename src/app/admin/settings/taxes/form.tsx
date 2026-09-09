'use client';

import { useActionState, useState } from 'react';
import { updateTax } from '@/server/settings';
import type { ActionState } from '@/server/courses';
import { formatMoney } from '@/lib/money';
import { Button, Card, Checkbox, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

interface Config {
  enabled: boolean;
  gstin: string;
  pan: string;
  state: string;
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
  pricesAreExclusive: boolean;
}

export function TaxForm({ config }: { config: Config }) {
  const [state, action, pending] = useActionState(updateTax, initial);
  const [cgst, setCgst] = useState(config.cgstPercent);
  const [sgst, setSgst] = useState(config.sgstPercent);
  const [exclusive, setExclusive] = useState(config.pricesAreExclusive);

  // Worked on a real listed price, because "exclusive" and "inclusive" are two
  // words that decide whether ₹7,000 means ₹7,000 or ₹8,260.
  const listed = 700000;
  const rate = cgst + sgst;
  const taxable = exclusive ? listed : Math.round((listed * 100) / (100 + rate));
  const taxDue = Math.round((taxable * rate) / 100);

  return (
    <Card>
      <h2 className="t-heading">Tax</h2>
      <p className="t-small muted mt-1">
        Applies to checkouts started from now on. Past orders keep the figures they were charged
        at, which is what makes an invoice worth anything.
      </p>

      <form action={action} className="mt-5 space-y-5">
        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />

        <Checkbox
          name="enabled"
          label="Charge tax on orders"
          hint="Turn off and prices are taken exactly as listed."
          defaultChecked={config.enabled}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="GSTIN">
            <Input name="gstin" defaultValue={config.gstin} maxLength={20} className="font-mono" />
          </Field>
          <Field label="PAN">
            <Input name="pan" defaultValue={config.pan} maxLength={15} className="font-mono" />
          </Field>
        </div>

        <Field label="Place of supply" hint="Your registered state. Sales inside it are CGST plus SGST.">
          <Input name="state" defaultValue={config.state} maxLength={80} placeholder="Kerala" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="CGST %">
            <Input
              name="cgstPercent"
              type="number"
              step="0.01"
              min={0}
              max={50}
              value={cgst}
              onChange={(e) => setCgst(Number(e.target.value))}
            />
          </Field>
          <Field label="SGST %">
            <Input
              name="sgstPercent"
              type="number"
              step="0.01"
              min={0}
              max={50}
              value={sgst}
              onChange={(e) => setSgst(Number(e.target.value))}
            />
          </Field>
          <Field label="IGST %" hint="Out of state">
            <Input
              name="igstPercent"
              type="number"
              step="0.01"
              min={0}
              max={50}
              defaultValue={config.igstPercent}
            />
          </Field>
        </div>

        <Checkbox
          name="pricesAreExclusive"
          label="Listed prices are before tax"
          hint="On: tax is added at checkout. Off: the listed price already contains it."
          checked={exclusive}
          onChange={(e) => setExclusive(e.currentTarget.checked)}
        />

        <div className="rounded-[var(--radius)] border bg-[var(--surface-2)] p-4">
          <p className="t-micro faint uppercase tracking-wide">
            A course listed at {formatMoney(listed)}
          </p>
          <dl className="mt-3 space-y-1.5">
            <Line label="Taxable value" value={formatMoney(taxable)} />
            <Line label={`GST at ${rate}%`} value={formatMoney(taxDue)} />
            <div className="flex items-baseline justify-between border-t pt-2">
              <dt className="text-sm font-medium">Learner pays</dt>
              <dd className="text-sm font-semibold tabular-nums">{formatMoney(taxable + taxDue)}</dd>
            </div>
          </dl>
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Save tax settings'}
        </Button>
      </form>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="t-small muted">{label}</dt>
      <dd className="t-small tabular-nums">{value}</dd>
    </div>
  );
}
