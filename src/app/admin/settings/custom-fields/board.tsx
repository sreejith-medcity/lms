'use client';

import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveCustomField,
  setCustomFieldActive,
  moveCustomField,
  deleteCustomField,
} from '@/server/custom-fields';
import type { ActionState } from '@/server/courses';
import { FIELD_TYPES } from '@/lib/custom-fields';
import {
  Badge,
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

export interface FieldRow {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string;
  showOnSignup: boolean;
  signupTiming: string | null;
  signupRequired: boolean;
  showOnOfflineForm: boolean;
  offlineRequired: boolean;
  isActive: boolean;
  answers: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function FieldsBoard({
  entity,
  entities,
  fields,
  canEdit,
}: {
  entity: string;
  entities: { value: string; label: string; note: string; count: number }[];
  fields: FieldRow[];
  canEdit: boolean;
}) {
  const note = entities.find((e) => e.value === entity)?.note ?? '';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {entities.map((e) => (
          <Link
            key={e.value}
            href={`/admin/settings/custom-fields?entity=${e.value}`}
            className={`rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition ${
              e.value === entity
                ? 'bg-[var(--brand)] text-[var(--brand-ink)]'
                : 'border bg-[var(--surface)] text-[var(--ink-2)] hover:border-[var(--brand)]'
            }`}
          >
            {e.label}
            {e.count > 0 && <span className="ml-1.5 tabular-nums opacity-70">{e.count}</span>}
          </Link>
        ))}
      </div>

      <p className="t-small muted">{note}</p>

      {fields.length === 0 ? (
        <Card>
          <p className="t-small muted">
            Nothing defined here yet. Fields you add appear on the relevant forms in the order they
            are listed.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {fields.map((f) => (
              <FieldItem key={f.id} field={f} canEdit={canEdit} />
            ))}
          </ul>
        </Card>
      )}

      {canEdit && <NewField entity={entity} />}
    </div>
  );
}

function FieldItem({ field, canEdit }: { field: FieldRow; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  function run(work: () => Promise<ActionState>) {
    start(async () => {
      const res = await work();
      setError(res.error);
      if (!res.error) router.refresh();
    });
  }

  return (
    <li className={`px-5 py-3 ${field.isActive ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {field.label}
            {!field.isActive && <Badge tone="neutral">off</Badge>}
            {field.showOnSignup && (
              <Badge tone={field.signupTiming === 'BEFORE' ? 'warn' : 'brand'}>
                {field.signupTiming === 'BEFORE' ? 'asked before signup' : 'asked after signup'}
              </Badge>
            )}
            {field.signupRequired && <Badge tone="bad">required</Badge>}
          </p>
          <p className="t-micro faint">
            {FIELD_TYPES.find((t) => t.value === field.type)?.label ?? field.type}
            {field.options ? ` · ${field.options}` : ''}
            {` · key ${field.key}`}
            {field.answers > 0 ? ` · ${field.answers} answered` : ''}
          </p>
        </div>

        {canEdit && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Move up"
              disabled={pending || !field.canMoveUp}
              onClick={() => run(() => moveCustomField(field.id, 'up'))}
            >
              ↑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Move down"
              disabled={pending || !field.canMoveDown}
              onClick={() => run(() => moveCustomField(field.id, 'down'))}
            >
              ↓
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => setCustomFieldActive(field.id, !field.isActive))}
            >
              {field.isActive ? 'Switch off' : 'Switch on'}
            </Button>
            {field.answers === 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => deleteCustomField(field.id))}
              >
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
      {error && <p className="t-small mt-1 text-[var(--bad)]">{error}</p>}
    </li>
  );
}

function NewField({ entity }: { entity: string }) {
  const [state, action, pending] = useActionState(saveCustomField, initial);
  const [type, setType] = useState('TEXT');
  const [onSignup, setOnSignup] = useState(false);
  const [timing, setTiming] = useState('AFTER');

  const needsOptions = type === 'DROPDOWN' || type === 'MULTISELECT';

  return (
    <Card>
      <h2 className="t-heading">Add a field</h2>
      <p className="t-small muted mt-1 max-w-prose">
        Prefer a list over free text wherever the answers are comparable: &quot;which branch&quot;
        as a dropdown can be counted, as text it cannot.
      </p>

      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="entity" value={entity} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Label" hint="What the person filling it in reads.">
            <Input name="label" required maxLength={120} placeholder="Passport number" />
          </Field>

          <Field label="Answered as" hint={FIELD_TYPES.find((t) => t.value === type)?.hint}>
            <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Choices"
            hint={needsOptions ? 'Separated by commas.' : 'Only used for a list.'}
          >
            <Input
              name="options"
              disabled={!needsOptions}
              maxLength={600}
              placeholder="Kochi, Kottayam, Kozhikode"
            />
          </Field>
        </div>

        {entity === 'LEARNER' && (
          <div className="space-y-3 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-4">
            <Checkbox
              name="showOnSignup"
              label="Ask this when somebody signs up"
              checked={onSignup}
              onChange={(e) => setOnSignup(e.target.checked)}
            />

            {onSignup && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="When"
                  hint={
                    timing === 'BEFORE'
                      ? 'Before signup is a barrier to signing up. Use it only for something you cannot enrol anybody without.'
                      : 'After signup, when they already have an account and a reason to fill it in. Almost always the right choice.'
                  }
                >
                  <Select
                    name="signupTiming"
                    value={timing}
                    onChange={(e) => setTiming(e.target.value)}
                  >
                    <option value="AFTER">After they have an account</option>
                    <option value="BEFORE">Before the account is created</option>
                  </Select>
                </Field>
                <div className="flex items-end pb-2">
                  <Checkbox name="signupRequired" label="They cannot skip it" />
                </div>
              </div>
            )}

            <Checkbox
              name="showOnOfflineForm"
              label="Ask it on the office enrolment form too"
              hint="For walk-ins the front desk enrols by hand."
            />
            <Checkbox name="offlineRequired" label="Required on that form" />
          </div>
        )}

        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />

        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add field'}
        </Button>
      </form>
    </Card>
  );
}
