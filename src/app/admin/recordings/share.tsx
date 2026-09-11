'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { revokeRecordingShare, shareRecording, type ShareResult } from '@/server/recording-shares';
import { Button, Field, FormError, Input, Select } from '@/components/ui';

const initial: ShareResult = {};

export interface ShareRow {
  id: string;
  learner: string;
  expiresLabel: string;
  views: string;
  revoked: boolean;
  path: string;
}

/**
 * Releasing one recording to one learner.
 *
 * The link is shown once it exists, with a copy button, because what happens
 * next is that somebody pastes it into WhatsApp. The existing links are
 * listed underneath with what is left of them, so the answer to "did you send
 * it and when does it run out" is on the same screen as the question.
 */
export function ShareRecording({
  recordingId,
  title,
  shares,
}: {
  recordingId: string;
  title: string;
  shares: ShareRow[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(shareRecording, initial);
  const [copied, setCopied] = useState(false);
  const [working, start] = useTransition();
  const router = useRouter();

  const link = state.path ? `${typeof window === 'undefined' ? '' : window.location.origin}${state.path}` : '';

  if (!open) {
    return (
      <button
        type="button"
        className="t-small hover:underline"
        style={{ color: 'var(--brand)' }}
        onClick={() => setOpen(true)}
      >
        Share{shares.filter((s) => !s.revoked).length > 0 ? ` (${shares.filter((s) => !s.revoked).length})` : ''}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-[var(--radius)] border bg-[var(--surface)] p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <p className="t-small font-medium">Share &ldquo;{title}&rdquo; with one learner</p>
        <button type="button" className="t-small faint underline" onClick={() => setOpen(false)}>
          close
        </button>
      </div>

      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="recordingId" value={recordingId} />

        <Field label="Learner" hint="Their email address or mobile number.">
          <Input name="learner" required placeholder="anu@example.com" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Access for">
            <Select name="days" defaultValue="2">
              <option value="1">1 day</option>
              <option value="2">2 days</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </Select>
          </Field>
          <Field label="Times they may open it" hint="Blank means as often as they like.">
            <Input name="maxViews" inputMode="numeric" placeholder="unlimited" />
          </Field>
        </div>

        <Field label="A line for them" hint="Optional. Shown above the video.">
          <Input name="note" maxLength={200} placeholder="The class you missed on Tuesday." />
        </Field>

        <FormError message={state.error} />

        <Button type="submit" disabled={pending}>
          {pending ? 'Making the link...' : 'Make the link'}
        </Button>
      </form>

      {state.ok && state.path && (
        <div className="mt-4 rounded-[var(--radius-sm)] border border-dashed p-3">
          <p className="t-small">{state.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="t-small min-w-0 flex-1 truncate font-mono">{link}</code>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                navigator.clipboard?.writeText(link).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="t-small faint mt-2">
            It only plays for that learner, signed in. Forwarding it does nothing.
          </p>
        </div>
      )}

      {shares.length > 0 && (
        <ul className="mt-4 space-y-2 border-t pt-3">
          {shares.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="t-small">
                {s.learner}
                <span className="faint"> · {s.revoked ? 'withdrawn' : s.expiresLabel}</span>
                <span className="faint"> · {s.views}</span>
              </span>
              {!s.revoked && (
                <button
                  type="button"
                  className="t-small underline"
                  style={{ color: 'var(--bad)' }}
                  disabled={working}
                  onClick={() =>
                    start(async () => {
                      await revokeRecordingShare(s.id);
                      router.refresh();
                    })
                  }
                >
                  withdraw
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
