'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveTemplate, deleteTemplate } from '@/server/campaigns';
import type { ActionState } from '@/server/courses';
import { TEMPLATE_VARIABLES, preview } from '@/lib/templates';
import {
  Badge,
  Button,
  Card,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
  Textarea,
} from '@/components/ui';

const initial: ActionState = {};

export function TemplateCard({
  template,
  canEdit,
}: {
  template: {
    id: string;
    name: string;
    channel: string;
    channelLabel: string;
    subject: string | null;
    body: string;
    variables: string[];
    usedBy: number;
    preview: string;
  };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [showPreview, setShowPreview] = useState(false);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{template.name}</p>
          <p className="t-micro faint">
            {template.channelLabel}
            {template.usedBy > 0 ? ` · used by ${template.usedBy} campaigns` : ''}
          </p>
        </div>
        <Badge>{template.channel.toLowerCase()}</Badge>
      </div>

      {template.subject && <p className="t-small mt-3 font-medium">{template.subject}</p>}
      <p className="t-small muted mt-1 whitespace-pre-wrap">
        {showPreview ? template.preview : template.body}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="t-small faint underline"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? 'Show the template' : 'Show it filled in'}
        </button>
        {template.variables.length > 0 && (
          <span className="t-micro faint">
            uses {template.variables.map((v) => `{{${v}}}`).join(', ')}
          </span>
        )}
        {canEdit && template.usedBy === 0 && (
          <button
            type="button"
            className="t-small faint ml-auto hover:text-[var(--bad)]"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteTemplate(template.id);
                setError(res.error);
                if (!res.error) router.refresh();
              })
            }
          >
            Delete
          </button>
        )}
      </div>
      {error && <p className="t-small mt-2 text-[var(--bad)]">{error}</p>}
    </Card>
  );
}

export function NewTemplate({ academy }: { academy: string }) {
  const [state, action, pending] = useActionState(saveTemplate, initial);
  const [channel, setChannel] = useState('EMAIL');
  const [body, setBody] = useState('');

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" hint="For your own team.">
          <Input name="name" required maxLength={120} placeholder="Class reminder" />
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
        <Field label="Event key" hint="Optional. Links it to an automatic notice.">
          <Input name="eventKey" maxLength={60} placeholder="session.reminder" />
        </Field>
      </div>

      {channel === 'EMAIL' && (
        <Field label="Subject">
          <Input name="subject" maxLength={200} placeholder="Your class starts in an hour" />
        </Field>
      )}

      <Field label="Message">
        <Textarea
          name="body"
          rows={5}
          required
          maxLength={4000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'Hi {{first_name}}, your {{course}} class starts soon. See you there.'}
        />
      </Field>

      <div className="rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3">
        <p className="t-micro faint font-semibold uppercase tracking-wide">Variables you can use</p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {TEMPLATE_VARIABLES.map((v) => (
            <li key={v.key} className="t-small">
              <button
                type="button"
                className="font-mono text-[var(--brand)] hover:underline"
                onClick={() => setBody((b) => `${b}{{${v.key}}}`)}
              >
                {`{{${v.key}}}`}
              </button>
              <span className="faint"> — {v.label}</span>
            </li>
          ))}
        </ul>
        {body && (
          <p className="t-small muted mt-3 whitespace-pre-wrap border-t pt-3">
            {preview(body, academy)}
          </p>
        )}
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save template'}
      </Button>
    </form>
  );
}
