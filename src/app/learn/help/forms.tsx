'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { closeOwnTicket, openTicket, replyAsLearner } from '@/server/help-desk';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';
import { HELP_CATEGORIES } from '@/lib/help-desk';
import { useT } from '@/components/i18n-provider';

const initial: ActionState = {};

export function NewTicketForm({ enrolments, uploads }: { enrolments: { id: string; label: string }[]; uploads: boolean }) {
  const [state, action, pending] = useActionState(openTicket, initial);
  const [category, setCategory] = useState('OTHER');
  const { t } = useT();
  const hint = HELP_CATEGORIES.find((c) => c.key === category)?.hint;
  return (
    <form action={action} className="space-y-4" encType="multipart/form-data">
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('What is it about')} hint={hint || undefined}>
          <Select name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {HELP_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>{t(c.label)}</option>
            ))}
          </Select>
        </Field>
        {enrolments.length > 0 && (
          <Field label={t('Which course')} hint="If it is about one.">
            <Select name="enrollmentId" defaultValue="">
              <option value="">{t('Not about a course')}</option>
              {enrolments.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label={t('Subject')}>
        <Input name="subject" required maxLength={140} placeholder="No receipt for Monday's payment" />
      </Field>
      <Field label={t('What happened')} hint="Dates, amounts, the lesson name: whatever lets the office fix it without writing back to ask.">
        <Textarea name="body" rows={5} required maxLength={5000} />
      </Field>
      {uploads && (
        <Field label="Attach a screenshot or file" hint="Up to 3 files, 10 MB each. Optional.">
          <input type="file" name="files" multiple accept="image/*,.pdf" className="t-small block" />
        </Field>
      )}
      <Button type="submit" disabled={pending}>{pending ? t('Sending…') : t('Send to the office')}</Button>
    </form>
  );
}

export function LearnerReplyForm({ ticketId, closed, uploads }: { ticketId: string; closed: boolean; uploads: boolean }) {
  const [state, action, pending] = useActionState(replyAsLearner, initial);
  const router = useRouter();
  const { t } = useT();
  if (state.ok) setTimeout(() => router.refresh(), 0);
  if (closed) return <p className="t-small faint">This ticket is closed. If it comes up again, open a new one.</p>;
  return (
    <form action={action} className="space-y-3" encType="multipart/form-data" key={state.ok ? 'sent' : 'draft'}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <Textarea name="body" rows={3} maxLength={5000} placeholder={t('Write a reply')} required />
      {uploads && <input type="file" name="files" multiple accept="image/*,.pdf" className="t-small block" />}
      <Button type="submit" size="sm" disabled={pending}>{pending ? t('Sending…') : t('Reply')}</Button>
    </form>
  );
}

export function CloseTicketButton({ ticketId }: { ticketId: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  const { t } = useT();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await closeOwnTicket(ticketId);
            setNote(r.error ?? null);
            if (!r.error) router.refresh();
          })
        }
        className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)] disabled:opacity-60"
      >
        {t('It is sorted, close it')}
      </button>
      {note && <span className="t-micro text-[var(--bad)]">{note}</span>}
    </span>
  );
}
