'use client';

import { useActionState, useState } from 'react';
import { saveSocialLinks, savePolicy } from '@/server/settings';
import type { ActionState } from '@/server/courses';
import {
  Badge,
  Button,
  Card,
  Field,
  FormError,
  FormSuccess,
  Input,
  Textarea,
} from '@/components/ui';

const initial: ActionState = {};

const NETWORKS = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'x', label: 'X' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

export function SocialForm({
  social,
  canEdit,
}: {
  social: Record<string, string>;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveSocialLinks, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {NETWORKS.map((n) => (
          <Field key={n.key} label={n.label}>
            <Input
              name={n.key}
              type="url"
              defaultValue={social[n.key] ?? ''}
              placeholder="https://…"
              disabled={!canEdit}
            />
          </Field>
        ))}
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      {canEdit && (
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save links'}
        </Button>
      )}
    </form>
  );
}

export function PolicyEditor({
  kind,
  heading,
  why,
  title,
  bodyHtml,
  updatedAt,
  canEdit,
}: {
  kind: string;
  heading: string;
  why: string;
  title: string;
  bodyHtml: string;
  updatedAt: string | null;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(savePolicy, initial);
  const [open, setOpen] = useState(false);

  const words = bodyHtml.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-medium">
            {heading}
            {updatedAt ? (
              <Badge tone="ok">published</Badge>
            ) : (
              <Badge tone="warn">not written</Badge>
            )}
          </p>
          <p className="t-small muted mt-1 max-w-prose">{why}</p>
          {updatedAt && (
            <p className="t-micro faint mt-1">
              {words} words, last edited{' '}
              {new Date(updatedAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          )}
        </div>

        {canEdit && !open && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {updatedAt ? 'Edit' : 'Write it'}
          </Button>
        )}
      </div>

      {open && (
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="kind" value={kind} />

          <Field label="Page title">
            <Input name="title" required defaultValue={title} maxLength={120} />
          </Field>

          <Field
            label="The policy"
            hint="Plain paragraphs, or simple HTML if you have it from a lawyer."
          >
            <Textarea name="bodyHtml" rows={10} required defaultValue={bodyHtml} />
          </Field>

          <FormError message={state.error} />
          <FormSuccess message={state.ok ? state.message : undefined} />

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <button type="button" className="t-small faint hover:underline" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
