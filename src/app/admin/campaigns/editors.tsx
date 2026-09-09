'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveCampaign,
  prepareCampaign,
  setCampaignStatus,
  deleteCampaign,
} from '@/server/campaigns';
import type { ActionState } from '@/server/courses';
import { AUDIENCES } from '@/lib/templates';
import { Button, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

export function NewCampaign({
  templates,
  batches,
  courses,
  segments,
}: {
  templates: { id: string; name: string; channel: string }[];
  batches: { id: string; name: string }[];
  courses: { id: string; name: string }[];
  segments: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveCampaign, initial);
  const [channel, setChannel] = useState('EMAIL');
  const [audience, setAudience] = useState('ALL_LEARNERS');

  const usable = templates.filter((t) => t.channel === channel);
  const options =
    audience === 'BATCH'
      ? batches
      : audience === 'COURSE'
        ? courses
        : audience === 'SEGMENT'
          ? segments
          : [];

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">
          <Input name="name" required maxLength={120} placeholder="Onam offer, A1 learners" />
        </Field>

        <Field label="Channel">
          <Select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="EMAIL">Email</option>
            <option value="SMS">SMS</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="PUSH">Push notification</option>
            <option value="IN_APP">In the app</option>
          </Select>
        </Field>

        <Field
          label="Template"
          hint={usable.length === 0 ? 'No template is written for this channel yet.' : undefined}
        >
          <Select name="templateId" required disabled={usable.length === 0}>
            {usable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Who it goes to">
          <Select name="audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>

        {options.length > 0 && (
          <Field
            label={
              audience === 'BATCH'
                ? 'Which batch'
                : audience === 'COURSE'
                  ? 'Which course'
                  : 'Which segment'
            }
          >
            <Select name="audienceId" required>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Send on" hint="Blank means as soon as sending is possible.">
          <Input name="scheduledAt" type="date" />
        </Field>
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Button type="submit" disabled={pending || usable.length === 0}>
        {pending ? 'Saving…' : 'Save draft'}
      </Button>
    </form>
  );
}

export function CampaignActions({
  id,
  status,
  recipients,
  sent,
}: {
  id: string;
  status: string;
  recipients: number;
  sent: boolean;
}) {
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

  const editable = status === 'DRAFT' || status === 'SCHEDULED';

  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {state.error && <span className="t-micro text-[var(--bad)]">{state.error}</span>}
      {state.ok && state.message && <span className="t-micro muted">{state.message}</span>}

      {editable && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => prepareCampaign(id))}>
          {recipients > 0 ? 'Redo audience' : 'Work out audience'}
        </Button>
      )}

      {status === 'DRAFT' && recipients > 0 && (
        <Button size="sm" disabled={pending} onClick={() => run(() => setCampaignStatus(id, 'SCHEDULED'))}>
          Schedule
        </Button>
      )}

      {status === 'SCHEDULED' && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setCampaignStatus(id, 'DRAFT'))}>
          Unschedule
        </Button>
      )}

      {!sent && (
        <button
          type="button"
          className="t-small faint hover:text-[var(--bad)]"
          disabled={pending}
          onClick={() => run(() => deleteCampaign(id))}
        >
          Delete
        </button>
      )}
    </span>
  );
}
