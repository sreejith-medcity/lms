'use client';

import { useActionState } from 'react';
import { savePlan } from '@/server/platform-tenants';
import type { ActionState } from '@/server/courses';
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Textarea } from '@/components/ui';

export interface PlanDraft {
  id: string;
  code: string;
  name: string;
  description: string;
  monthly: number;
  quarterly: number;
  annual: number;
  trialDays: number;
  isPublic: boolean;
  isActive: boolean;
  limits: Record<string, { included: number; cap: number; overage: number }>;
  features: Record<string, boolean>;
}

const METRICS = [
  { key: 'ACTIVE_LEARNERS', label: 'Active learners', unit: 'learners' },
  { key: 'STAFF_SEATS', label: 'Staff seats', unit: 'seats' },
  { key: 'BRANCHES', label: 'Branches', unit: 'branches' },
  { key: 'COURSES', label: 'Courses', unit: 'courses' },
  { key: 'STORAGE_BYTES', label: 'Storage', unit: 'GB' },
];
const FEATURES = ['events', 'memberships', 'mentorships', 'community', 'ai_companion', 'white_label', 'sso', 'api', 'scorm'];

export function PlanForm({ draft }: { draft: PlanDraft | null }) {
  const [state, action, pending] = useActionState(savePlan, {} as ActionState);
  return (
    <form action={action} className="space-y-4">
      {draft && <input type="hidden" name="id" value={draft.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" hint="starter, growth, power"><Input name="code" defaultValue={draft?.code ?? ''} required className="font-mono" /></Field>
        <Field label="Name"><Input name="name" defaultValue={draft?.name ?? ''} required /></Field>
        <Field label="Trial days"><Input name="trialDays" type="number" min={0} max={90} defaultValue={draft?.trialDays ?? 14} /></Field>
      </div>
      <Field label="Description" hint="One line on the start page."><Textarea name="description" rows={2} defaultValue={draft?.description ?? ''} /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Monthly (₹)"><Input name="monthly" type="number" min={0} step="1" defaultValue={draft?.monthly ?? 0} /></Field>
        <Field label="Quarterly (₹)" hint="Blank for three months' worth."><Input name="quarterly" type="number" min={0} step="1" defaultValue={draft?.quarterly || ''} /></Field>
        <Field label="Annual (₹)" hint="Blank for twelve months' worth."><Input name="annual" type="number" min={0} step="1" defaultValue={draft?.annual || ''} /></Field>
      </div>
      <div>
        <p className="t-small font-medium">Limits</p>
        <p className="t-small faint">Included in the price; a hard cap refuses more; a per-unit overage bills the excess instead. Leave the cap blank and the overage at zero for no limit.</p>
        <div className="mt-2 space-y-2">
          {METRICS.map((m) => (
            <div key={m.key} className="grid items-end gap-2 sm:grid-cols-4">
              <span className="t-small">{m.label} <span className="faint">({m.unit})</span></span>
              <Input name={`included_${m.key}`} type="number" min={0} step="any" defaultValue={draft?.limits[m.key]?.included ?? 0} placeholder="included" />
              <Input name={`cap_${m.key}`} type="number" min={0} step="any" defaultValue={draft?.limits[m.key]?.cap || ''} placeholder="hard cap" />
              <Input name={`overage_${m.key}`} type="number" min={0} step="0.01" defaultValue={draft?.limits[m.key]?.overage ?? 0} placeholder="₹ per unit over" />
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="t-small font-medium">Features</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <Checkbox key={f} name={`feature_${f}`} label={f.replace('_', ' ')} defaultChecked={draft?.features[f] ?? true} />
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Checkbox name="isPublic" label="Shown on the start page" defaultChecked={draft?.isPublic ?? true} />
        <Checkbox name="isActive" label="Active" hint="Off keeps existing subscribers but takes no new ones." defaultChecked={draft?.isActive ?? true} />
      </div>
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : draft ? 'Save plan' : 'Add plan'}</Button>
    </form>
  );
}
