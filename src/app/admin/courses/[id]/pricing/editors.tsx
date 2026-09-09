'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  addPricingPlan,
  deletePricingPlan,
  updatePublishing,
  type ActionState,
} from '@/server/courses';
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

export function AddPlanForm({
  productId,
  currency,
  branches,
}: {
  productId: string;
  currency: string;
  branches: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(addPricingPlan, initial);
  const [planType, setPlanType] = useState('ONE_TIME');
  const [price, setPrice] = useState(0);
  const [count, setCount] = useState(3);
  const [gap, setGap] = useState(30);

  const free = price === 0;
  const instalment = planType === 'INSTALMENT' && !free;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="productId" value={productId} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? 'Plan added.' : undefined} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Plan name">
          <Input name="name" placeholder="Full fees" required maxLength={60} />
        </Field>

        <Field label={`Price (${currency})`} hint="Zero makes the course free.">
          <Input
            name="priceRupees"
            type="number"
            min={0}
            step="0.01"
            required
            value={price}
            onChange={(e) => setPrice(Number(e.target.value) || 0)}
          />
        </Field>

        <Field label={`Struck-through price (${currency})`} hint="Optional. Must be above the price.">
          <Input name="mrpRupees" type="number" min={0} step="0.01" />
        </Field>

        <Field label="Validity in days" hint="Blank means access never expires.">
          <Input name="validityDays" type="number" min={0} step={1} />
        </Field>

        <Field
          label="Branch"
          hint="Leave on every branch unless this price is only for one campus."
        >
          <Select name="branchId" defaultValue="">
            <option value="">Every branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="How it is paid">
          <Select
            name="planType"
            value={free ? 'FREE' : planType}
            disabled={free}
            onChange={(e) => setPlanType(e.target.value)}
          >
            <option value="ONE_TIME">In full, once</option>
            <option value="INSTALMENT">In instalments</option>
            <option value="SUBSCRIPTION">As a subscription</option>
            {free && <option value="FREE">Free</option>}
          </Select>
        </Field>
      </div>

      {instalment && (
        <div className="rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Number of payments">
              <Input
                name="instalmentCount"
                type="number"
                min={2}
                max={24}
                value={count}
                onChange={(e) => setCount(Math.max(2, Number(e.target.value) || 2))}
              />
            </Field>
            <Field label="Days apart">
              <Input
                name="instalmentGapDays"
                type="number"
                min={1}
                max={365}
                value={gap}
                onChange={(e) => setGap(Math.max(1, Number(e.target.value) || 1))}
              />
            </Field>
            <Field label="Counted from">
              <Select name="invoiceAnchor" defaultValue="CLASS_COMMENCEMENT">
                <option value="CLASS_COMMENCEMENT">The batch start date</option>
                <option value="ENROLLMENT">The day they enrol</option>
              </Select>
            </Field>
          </div>
          <p className="t-small faint mt-3">{describeSchedule(price, count, gap, currency)}</p>
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add plan'}
      </Button>
    </form>
  );
}

/** Show the office the actual dues, so nobody has to trust the arithmetic. */
function describeSchedule(price: number, count: number, gap: number, currency: string) {
  if (price <= 0 || count < 2) return 'Set a price to see the schedule.';
  const paise = Math.round(price * 100);
  const each = Math.floor(paise / count);
  const first = each + (paise - each * count);
  const fmt = (p: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
      p / 100,
    );
  return `${fmt(first)} on day 0, then ${count - 1} × ${fmt(each)} every ${gap} days.`;
}

export function DeletePlanButton({ planId, productId }: { planId: string; productId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <span className="flex items-center justify-end gap-2">
      {error && <span className="text-xs text-[var(--bad)]">{error}</span>}
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        title="Plans with enrolments are retired rather than deleted"
        onClick={() => start(async () => setError((await deletePricingPlan(planId, productId)).error))}
      >
        {pending ? '…' : 'Remove'}
      </Button>
    </span>
  );
}

/**
 * Where the course can be reached.
 *
 * Its own form because these switches decide whether anybody can buy the thing;
 * folded into a form about wording, they get flipped by accident.
 */
export function PublishingForm({
  productId,
  published,
  values,
  canEdit,
}: {
  productId: string;
  published: boolean;
  values: {
    publishWeb: boolean;
    publishAndroid: boolean;
    publishIos: boolean;
    freePreviewEnabled: boolean;
    onDemandOnly: boolean;
    isFeatured: boolean;
    appleIapProductId: string;
  };
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(updatePublishing, initial);
  const [ios, setIos] = useState(values.publishIos);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="productId" value={productId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Checkbox
          name="publishWeb"
          label="On the website"
          hint="Listed in the catalogue and buyable."
          defaultChecked={values.publishWeb}
          disabled={!canEdit}
        />
        <Checkbox
          name="onDemandOnly"
          label="Enrolled by the office only"
          hint="Hidden from the catalogue; staff enrol people directly."
          defaultChecked={values.onDemandOnly}
          disabled={!canEdit}
        />
        <Checkbox
          name="publishAndroid"
          label="On Android"
          defaultChecked={values.publishAndroid}
          disabled={!canEdit}
        />
        <Checkbox
          name="publishIos"
          label="On iOS"
          checked={ios}
          onChange={(e) => setIos(e.target.checked)}
          disabled={!canEdit}
        />
        <Checkbox
          name="freePreviewEnabled"
          label="Free preview"
          hint="Lessons marked previewable open without paying."
          defaultChecked={values.freePreviewEnabled}
          disabled={!canEdit}
        />
        <Checkbox
          name="isFeatured"
          label="Feature on the home page"
          defaultChecked={values.isFeatured}
          disabled={!canEdit}
        />
      </div>

      {ios && (
        <Field
          label="Apple in-app purchase product ID"
          hint="Apple takes its cut through IAP, so paid iOS courses need the matching product."
        >
          <Input
            name="appleIapProductId"
            defaultValue={values.appleIapProductId}
            placeholder="com.example.course.full"
            disabled={!canEdit}
          />
        </Field>
      )}

      {published && (
        <p className="t-small faint">
          This course is published. Turning off both the website and office-only enrolment would
          leave it reachable by nobody, so that combination is refused.
        </p>
      )}

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
