'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteWorkflow, saveWorkflow, setWorkflowActive, testWorkflow } from '@/server/workflows';
import type { ActionState } from '@/server/courses';
import { CONDITION_KINDS, MESSAGE_VARIABLES, describeDelay, stepProblem, parseStepConfig } from '@/lib/workflow-rules';
import type { TriggerFilters } from '@/lib/workflow-rules';
import { Button, Card, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

/**
 * The editor: what starts it, how it is narrowed, then the steps in order.
 *
 * Steps live in React state and go to the server as one JSON field. Each
 * step is checked as it is edited, in the same words the server would use,
 * so the Save button never reveals a problem the card did not.
 */

export interface EditorStep {
  actionType: string;
  delayMinutes: number;
  config: Record<string, unknown>;
}

type Option = { id: string; title?: string; name?: string };

const initial: ActionState & { id?: string } = {};

const UNITS = [
  { key: 'minutes', label: 'minutes', factor: 1 },
  { key: 'hours', label: 'hours', factor: 60 },
  { key: 'days', label: 'days', factor: 1440 },
] as const;

function splitDelay(minutes: number): { value: number; unit: (typeof UNITS)[number]['key'] } {
  if (minutes > 0 && minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' };
  if (minutes > 0 && minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

export function WorkflowEditor({
  workflow,
  filters,
  steps: initialSteps,
  events,
  actions,
  products,
  batches,
  templates,
  canEdit,
}: {
  workflow: { id: string | null; name: string; description: string; triggerType: string; runOnce: boolean } | null;
  filters: TriggerFilters;
  steps: EditorStep[];
  events: { key: string; label: string; group: string; filters: string[] }[];
  actions: { key: string; label: string; blurb: string }[];
  products: Option[];
  batches: Option[];
  templates: { id: string; name: string; channel: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveWorkflow, initial);
  const [triggerType, setTriggerType] = useState(workflow?.triggerType ?? 'enrolment.created');
  const [steps, setSteps] = useState<EditorStep[]>(initialSteps);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (state.ok && state.id && !workflow?.id) router.push(`/admin/workflows/${state.id}`);
  }, [state, workflow?.id, router]);

  const event = events.find((e) => e.key === triggerType);
  const groups = [...new Set(events.map((e) => e.group))];

  const update = (i: number, patch: Partial<EditorStep>) => setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const updateConfig = (i: number, patch: Record<string, unknown>) => setSteps((all) => all.map((s, j) => (j === i ? { ...s, config: { ...s.config, ...patch } } : s)));
  const move = (i: number, dir: -1 | 1) =>
    setSteps((all) => {
      const j = i + dir;
      if (j < 0 || j >= all.length) return all;
      const next = [...all];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => setSteps((all) => all.filter((_, j) => j !== i));
  const add = (actionType: string) => {
    setSteps((all) => [...all, { actionType, delayMinutes: actionType === 'WAIT' ? 1440 : 0, config: actionType === 'SEND_MESSAGE' ? { channel: 'EMAIL' } : {} }]);
    setAdding(false);
  };

  const problems = steps.map((s) => stepProblem(s.actionType, parseStepConfig(s.config)));

  return (
    <form action={action} className="space-y-4">
      {workflow?.id && <input type="hidden" name="id" value={workflow.id} />}
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />

      <Card className="space-y-4">
        <Field label="Name">
          <Input name="name" defaultValue={workflow?.name ?? ''} required maxLength={120} placeholder="Welcome sequence" disabled={!canEdit} />
        </Field>
        <Field label="What it is for" hint="For whoever reads this list in a year.">
          <Input name="description" defaultValue={workflow?.description ?? ''} maxLength={500} disabled={!canEdit} />
        </Field>
      </Card>

      <Card className="space-y-4">
        <p className="t-eyebrow" style={{ color: 'var(--brand)' }}>
          When
        </p>
        <Field label="This happens">
          <Select name="triggerType" value={triggerType} onChange={(e) => setTriggerType(e.target.value)} disabled={!canEdit}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {events.filter((e) => e.group === g).map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        {event?.filters.includes('days') && (
          <Field label="After how many quiet days" hint="No lesson opened and no class joined for this long.">
            <Input name="days" type="number" min={1} max={365} defaultValue={filters.days} className="w-32" disabled={!canEdit} />
          </Field>
        )}
        {event?.filters.includes('outcome') && (
          <Field label="Which papers">
            <Select name="outcome" defaultValue={filters.outcome} disabled={!canEdit}>
              <option value="ANY">Any result</option>
              <option value="PASSED">Passed only</option>
              <option value="FAILED">Failed only</option>
            </Select>
          </Field>
        )}
        {event?.filters.includes('products') && products.length > 0 && (
          <Field label="Only for these courses" hint="Leave all unticked for every course.">
            <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-[var(--radius-sm)] border p-3 sm:grid-cols-2">
              {products.map((p) => (
                <Checkbox key={p.id} name="productIds" value={p.id} defaultChecked={filters.productIds.includes(p.id)} label={p.title ?? ''} disabled={!canEdit} />
              ))}
            </div>
          </Field>
        )}
        {event?.filters.includes('batches') && batches.length > 0 && (
          <Field label="Only for these batches" hint="Leave all unticked for every batch.">
            <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-[var(--radius-sm)] border p-3 sm:grid-cols-2">
              {batches.map((b) => (
                <Checkbox key={b.id} name="batchIds" value={b.id} defaultChecked={filters.batchIds.includes(b.id)} label={b.name ?? ''} disabled={!canEdit} />
              ))}
            </div>
          </Field>
        )}

        <Field label="How often per person">
          <Select name="runOnce" defaultValue={workflow ? String(workflow.runOnce) : 'true'} disabled={!canEdit}>
            <option value="true">Once ever, whatever happens later</option>
            <option value="false">Once for each thing it is about (each course, each paper, each cart)</option>
          </Select>
        </Field>
      </Card>

      <div className="space-y-3">
        <p className="t-eyebrow" style={{ color: 'var(--brand)' }}>
          Then
        </p>

        {steps.length === 0 && <p className="t-small faint">No steps yet. Add the first one below.</p>}

        {steps.map((step, i) => (
          <StepCard
            key={i}
            index={i}
            step={step}
            problem={problems[i]}
            actions={actions}
            products={products}
            templates={templates}
            canEdit={canEdit}
            onChange={(patch) => update(i, patch)}
            onConfig={(patch) => updateConfig(i, patch)}
            onMove={(dir) => move(i, dir)}
            onRemove={() => remove(i)}
            isFirst={i === 0}
            isLast={i === steps.length - 1}
          />
        ))}

        {canEdit &&
          (adding ? (
            <Card>
              <p className="t-small font-medium">Add a step</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {actions.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => add(a.key)}
                    className="rounded-[var(--radius-sm)] border p-3 text-left transition hover:border-[var(--brand)]"
                  >
                    <span className="block text-sm font-medium">{a.label}</span>
                    {a.blurb && <span className="t-micro faint block">{a.blurb}</span>}
                  </button>
                ))}
              </div>
              <button type="button" className="t-small faint mt-3 hover:underline" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </Card>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
              Add a step
            </Button>
          ))}
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || steps.length === 0 || problems.some(Boolean)}>
            {pending ? 'Saving...' : 'Save'}
          </Button>
          {problems.some(Boolean) && <span className="t-small text-[var(--warn)]">A step still needs something; see the note on it.</span>}
          {workflow?.id && <DeleteButton id={workflow.id} />}
        </div>
      )}
    </form>
  );
}

function StepCard({
  index,
  step,
  problem,
  actions,
  products,
  templates,
  canEdit,
  onChange,
  onConfig,
  onMove,
  onRemove,
  isFirst,
  isLast,
}: {
  index: number;
  step: EditorStep;
  problem: string | null;
  actions: { key: string; label: string; blurb: string }[];
  products: Option[];
  templates: { id: string; name: string; channel: string }[];
  canEdit: boolean;
  onChange: (patch: Partial<EditorStep>) => void;
  onConfig: (patch: Record<string, unknown>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const c = step.config;
  const label = actions.find((a) => a.key === step.actionType)?.label ?? step.actionType;
  const delay = splitDelay(step.delayMinutes);
  const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : '');
  const num = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : c[k] ? Number(c[k]) : '');
  const needs = CONDITION_KINDS.find((k) => k.key === str('condition'))?.needs;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand)] text-xs font-bold text-[var(--brand-ink)]">{index + 1}</span>
        <span className="font-semibold">{label}</span>
        <span className="t-small faint">
          {step.actionType === 'WAIT' ? describeDelay(step.delayMinutes) : step.delayMinutes > 0 ? `after ${describeDelay(step.delayMinutes)}` : isFirst ? 'straight away' : 'right after the previous step'}
        </span>
        {canEdit && (
          <span className="ml-auto flex items-center gap-1">
            <button type="button" className="t-small faint px-1 hover:underline disabled:opacity-30" onClick={() => onMove(-1)} disabled={isFirst} aria-label="Move up">
              ↑
            </button>
            <button type="button" className="t-small faint px-1 hover:underline disabled:opacity-30" onClick={() => onMove(1)} disabled={isLast} aria-label="Move down">
              ↓
            </button>
            <button type="button" className="t-small faint px-1 hover:text-[var(--bad)]" onClick={onRemove}>
              Remove
            </button>
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          {step.actionType === 'SEND_MESSAGE' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Wording">
                  <Select
                    value={str('templateId') ? `tpl:${str('templateId')}` : 'inline'}
                    onChange={(e) => onConfig(e.target.value === 'inline' ? { templateId: '' } : { templateId: e.target.value.slice(4) })}
                    disabled={!canEdit}
                  >
                    <option value="inline">Written here</option>
                    {templates.length > 0 && (
                      <optgroup label="Saved templates">
                        {templates.map((t) => (
                          <option key={t.id} value={`tpl:${t.id}`}>
                            {t.name} ({t.channel.toLowerCase()})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                </Field>
                {!str('templateId') && (
                  <Field label="Channel">
                    <Select value={str('channel') || 'EMAIL'} onChange={(e) => onConfig({ channel: e.target.value })} disabled={!canEdit}>
                      <option value="EMAIL">Email</option>
                      <option value="SMS">SMS</option>
                      <option value="WHATSAPP">WhatsApp (needs a template)</option>
                    </Select>
                  </Field>
                )}
              </div>
              {!str('templateId') && (
                <>
                  {(str('channel') || 'EMAIL') === 'EMAIL' && (
                    <Field label="Subject">
                      <Input value={str('subject')} onChange={(e) => onConfig({ subject: e.target.value })} maxLength={200} disabled={!canEdit} />
                    </Field>
                  )}
                  <Field label="Message" hint={`You can use ${MESSAGE_VARIABLES.map((v) => `{{${v}}}`).join(', ')}. A variable with nothing to fill it stops the message rather than sending a blank.`}>
                    <Textarea value={str('body')} onChange={(e) => onConfig({ body: e.target.value })} rows={4} maxLength={4000} disabled={!canEdit} />
                  </Field>
                </>
              )}
            </>
          )}

          {step.actionType === 'CONDITION' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Continue only if">
                <Select value={str('condition')} onChange={(e) => onConfig({ condition: e.target.value })} disabled={!canEdit}>
                  <option value="">Pick one</option>
                  {CONDITION_KINDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {needs === 'product' && (
                <Field label="Course">
                  <Select value={str('productId')} onChange={(e) => onConfig({ productId: e.target.value })} disabled={!canEdit}>
                    <option value="">Pick one</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {needs === 'tag' && (
                <Field label="Tag">
                  <Input value={str('tag')} onChange={(e) => onConfig({ tag: e.target.value })} maxLength={60} disabled={!canEdit} />
                </Field>
              )}
              {needs === 'days' && (
                <Field label="Days">
                  <Input type="number" min={1} max={365} value={num('days') || 7} onChange={(e) => onConfig({ days: Number(e.target.value) })} disabled={!canEdit} />
                </Field>
              )}
            </div>
          )}

          {(step.actionType === 'ADD_TAG' || step.actionType === 'REMOVE_TAG') && (
            <Field label="Tag" hint="Lower case, spaces allowed. The same tag on the learner page and in segments.">
              <Input value={str('tag')} onChange={(e) => onConfig({ tag: e.target.value })} maxLength={60} placeholder="needs a call" disabled={!canEdit} />
            </Field>
          )}

          {step.actionType === 'ADD_POINTS' && (
            <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
              <Field label="Points">
                <Input type="number" min={1} max={100000} value={num('points')} onChange={(e) => onConfig({ points: Number(e.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="Note they will see">
                <Input value={str('note')} onChange={(e) => onConfig({ note: e.target.value })} maxLength={200} placeholder="For finishing a course" disabled={!canEdit} />
              </Field>
            </div>
          )}

          {step.actionType === 'FOLLOW_UP' && (
            <div className="grid gap-3 sm:grid-cols-[10rem_8rem_minmax(0,1fr)]">
              <Field label="By">
                <Select value={str('followUpChannel') || 'CALL'} onChange={(e) => onConfig({ followUpChannel: e.target.value })} disabled={!canEdit}>
                  <option value="CALL">Phone call</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="EMAIL">Email</option>
                </Select>
              </Field>
              <Field label="Due in (days)">
                <Input type="number" min={0} max={365} value={num('daysFromNow') === '' ? 1 : num('daysFromNow')} onChange={(e) => onConfig({ daysFromNow: Number(e.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="Note for the counsellor">
                <Input value={str('note')} onChange={(e) => onConfig({ note: e.target.value })} maxLength={500} disabled={!canEdit} />
              </Field>
            </div>
          )}

          {step.actionType === 'ENROL' && (
            <Field label="Course" hint="Enrolled without payment, into the default batch. Skipped if they are already in it.">
              <Select value={str('productId')} onChange={(e) => onConfig({ productId: e.target.value })} disabled={!canEdit}>
                <option value="">Pick one</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {step.actionType === 'WEBHOOK' && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <Field label="URL" hint="Receives a JSON POST with the learner id and what the event carried.">
                <Input value={str('url')} onChange={(e) => onConfig({ url: e.target.value })} placeholder="https://" maxLength={500} disabled={!canEdit} />
              </Field>
              <Field label="Signing secret (optional)">
                <Input value={str('secret')} onChange={(e) => onConfig({ secret: e.target.value })} maxLength={200} autoComplete="off" disabled={!canEdit} />
              </Field>
            </div>
          )}

          {step.actionType === 'WAIT' && <p className="t-small muted">Nothing happens until the wait is over; the next step runs then.</p>}
        </div>

        <Field label={step.actionType === 'WAIT' ? 'For' : 'Wait first'} hint={step.actionType === 'WAIT' ? undefined : 'Before this step runs.'}>
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              max={365}
              className="w-20"
              value={delay.value}
              onChange={(e) => onChange({ delayMinutes: Math.max(0, Number(e.target.value) || 0) * UNITS.find((u) => u.key === delay.unit)!.factor })}
              disabled={!canEdit}
            />
            <Select
              className="w-32"
              value={delay.unit}
              onChange={(e) => onChange({ delayMinutes: delay.value * UNITS.find((u) => u.key === e.target.value)!.factor })}
              disabled={!canEdit}
            >
              {UNITS.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      </div>

      {problem && <p className="t-small text-[var(--warn)]">{problem}</p>}
    </Card>
  );
}

export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={active ? 'secondary' : 'primary'}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setWorkflowActive(id, !active);
            if (res.error) setError(res.error);
            else {
              setError(undefined);
              router.refresh();
            }
          })
        }
      >
        {pending ? '...' : active ? 'Switch off' : 'Switch on'}
      </Button>
      {error && <span className="t-micro text-[var(--bad)]">{error}</span>}
    </span>
  );
}

export function TestRun({ id, learners }: { id: string; learners: { id: string; label: string }[] }) {
  const [learner, setLearner] = useState('');
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const router = useRouter();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Select value={learner} onChange={(e) => setLearner(e.target.value)} className="max-w-md">
          <option value="">Pick a learner</option>
          {learners.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !learner}
          onClick={() =>
            start(async () => {
              const res = await testWorkflow(id, learner);
              setState(res);
              if (res.ok) router.refresh();
            })
          }
        >
          {pending ? 'Running...' : 'Run it now'}
        </Button>
      </div>
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
    </div>
  );
}

function DeleteButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  const router = useRouter();
  if (!armed) {
    return (
      <button type="button" className="t-small faint ml-auto hover:text-[var(--bad)]" onClick={() => setArmed(true)}>
        Delete this automation
      </button>
    );
  }
  return (
    <span className="ml-auto flex items-center gap-2">
      <span className="t-small">Runs under way stop. Sure?</span>
      <Button
        type="button"
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deleteWorkflow(id);
            if (res.ok) router.push('/admin/workflows');
          })
        }
      >
        Delete
      </Button>
      <button type="button" className="t-small faint hover:underline" onClick={() => setArmed(false)}>
        Keep it
      </button>
    </span>
  );
}
