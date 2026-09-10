'use client';

import { useActionState } from 'react';
import { attachAddon, detachAddon, setAddonOnly } from '@/server/addons';
import type { ActionState } from '@/server/courses';
import {
  Button,
  Card,
  Checkbox,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
} from '@/components/ui';

const initial: ActionState = {};

export interface AttachedAddon {
  id: string;
  title: string;
  label: string | null;
  note: string | null;
  isPreselected: boolean;
  priceLabel: string;
}

/**
 * Add-ons, from the course they hang off.
 *
 * Deliberately not a picker over every product in the catalogue with no
 * warning attached: attaching an add-on changes what a buyer is charged, so
 * the screen says what each choice does in the words a buyer will see rather
 * than in field names.
 */
export function AddonsForm({
  productId,
  attached,
  candidates,
  isAddonOnly,
}: {
  productId: string;
  attached: AttachedAddon[];
  candidates: { id: string; title: string; priceLabel: string }[];
  isAddonOnly: boolean;
}) {
  const [attachState, attachAction, attaching] = useActionState(attachAddon, initial);
  const [detachState, detachAction] = useActionState(detachAddon, initial);
  const [onlyState, onlyAction] = useActionState(setAddonOnly, initial);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="t-heading">Sold with this course</h2>
        <p className="t-small muted mt-1">
          Anything here appears as a tick box on the course page and on the catalogue card, at
          its own price. Nothing is ticked for the buyer unless you say so.
        </p>

        {attached.length === 0 ? (
          <p className="t-small faint mt-4">Nothing is offered alongside this course yet.</p>
        ) : (
          <ul className="mt-4 divide-y rounded-[var(--radius-sm)] border">
            {attached.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{a.label ?? `Add ${a.title}`}</p>
                  <p className="t-small faint">
                    {a.title} · {a.priceLabel}
                    {a.isPreselected ? ' · ticked by default' : ''}
                    {a.note ? ` · ${a.note}` : ''}
                  </p>
                </div>
                <form action={detachAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <Button type="submit" variant="danger" size="sm">
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <FormError message={detachState.error} />
        <FormSuccess message={detachState.message} />

        {candidates.length === 0 ? (
          <p className="t-small faint mt-5">
            There is nothing else priced in this catalogue to offer. Create the product and give
            it an active plan first, then come back.
          </p>
        ) : (
          <form action={attachAction} className="mt-5 space-y-3 border-t pt-5">
            <input type="hidden" name="productId" value={productId} />

            <Field label="Offer this alongside it">
              <Select name="addonProductId" required defaultValue="">
                <option value="" disabled>
                  Choose a product
                </option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.priceLabel})
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What the tick box says" hint="Leave blank to use the product's own name.">
                <Input name="label" maxLength={80} placeholder="Add Archer Review" />
              </Field>
              <Field label="The small print under it" hint="Optional. One short line.">
                <Input name="note" maxLength={160} placeholder="Optional NCLEX question bank" />
              </Field>
            </div>

            <Checkbox
              name="isPreselected"
              label="Tick it for the buyer by default"
              hint="Off is the honest default. A paid extra that arrives already ticked is the kind of thing buyers notice on their statement rather than at checkout."
            />

            <FormError message={attachState.error} />
            <FormSuccess message={attachState.message} />

            <Button type="submit" disabled={attaching}>
              {attaching ? 'Attaching...' : 'Attach add-on'}
            </Button>
          </form>
        )}
      </Card>

      <Card>
        <h2 className="t-heading">Sell this only as an add-on</h2>
        <p className="t-small muted mt-1">
          For something bought in from elsewhere that is not a course of its own. It disappears
          from the catalogue, from related-course lists and from its own page, and checkout
          refuses it unless it is ticked alongside a course.
        </p>

        <form action={onlyAction} className="mt-4 space-y-3">
          <input type="hidden" name="productId" value={productId} />
          <Checkbox
            name="isAddonOnly"
            label="Hide this from the catalogue"
            defaultChecked={isAddonOnly}
          />
          <FormError message={onlyState.error} />
          <FormSuccess message={onlyState.message} />
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </form>
      </Card>
    </div>
  );
}
