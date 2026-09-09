'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addLeadNote,
  claimLead,
  completeFollowUp,
  linkLeadToLearner,
  setLeadStage,
  STAGES,
} from '@/server/leads';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Field, FormError, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  interestedIn: string | null;
  source: string | null;
  stage: string;
  createdAt: string;
  owner: string | null;
  converted: boolean;
  followUp: { id: string; dueAt: string; note: string | null } | null;
  activities: { id: string; type: string; body: string | null; to: string | null; at: string }[];
}

export function LeadList({
  leads,
  learners,
  canEdit,
}: {
  leads: Lead[];
  learners: { id: string; name: string; email: string | null }[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {leads.map((lead) => {
        const overdue = lead.followUp && new Date(lead.followUp.dueAt) < new Date();

        return (
          <Card key={lead.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{lead.name}</p>
                  <Badge
                    tone={lead.stage === 'WON' ? 'ok' : lead.stage === 'LOST' ? 'bad' : 'neutral'}
                  >
                    {lead.stage.toLowerCase().replace('_', ' ')}
                  </Badge>
                  {lead.converted && <Badge tone="ok">enrolled</Badge>}
                  {overdue && <Badge tone="bad">follow-up overdue</Badge>}
                </div>

                <p className="t-small faint mt-1">
                  {[lead.email, lead.phone].filter(Boolean).join(' · ') || 'No contact details'}
                </p>

                <p className="t-small faint mt-1">
                  {lead.interestedIn ? `Interested in ${lead.interestedIn} · ` : ''}
                  {lead.source ? `${lead.source.toLowerCase()} · ` : ''}
                  {new Date(lead.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  })}
                  {lead.owner ? ` · ${lead.owner}` : ' · unclaimed'}
                </p>

                {lead.message && (
                  <p className="t-small muted mt-2 max-w-prose whitespace-pre-wrap">
                    {lead.message}
                  </p>
                )}

                {lead.followUp && (
                  <p className={`t-small mt-2 ${overdue ? 'text-[var(--bad)]' : 'faint'}`}>
                    Next: {new Date(lead.followUp.dueAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                    {lead.followUp.note ? ` — ${lead.followUp.note}` : ''}
                    {canEdit && <CompleteFollowUp id={lead.followUp.id} />}
                  </p>
                )}
              </div>

              {canEdit && (
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <StagePicker id={lead.id} stage={lead.stage} />
                  {!lead.owner && <Claim id={lead.id} />}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpen((o) => (o === lead.id ? null : lead.id))}
                  >
                    {open === lead.id ? 'Close' : 'Log a contact'}
                  </Button>
                </div>
              )}
            </div>

            {lead.activities.length > 0 && (
              <ul className="mt-3 space-y-1 border-t pt-3">
                {lead.activities.map((a) => (
                  <li key={a.id} className="t-small faint">
                    <span className="font-medium">{a.type.toLowerCase().replace('_', ' ')}</span>
                    {a.body ? ` — ${a.body}` : a.to ? ` → ${a.to.toLowerCase()}` : ''}
                    <span className="ml-2">
                      {new Date(a.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {open === lead.id && (
              <div className="mt-4 grid gap-5 border-t pt-4 lg:grid-cols-2">
                <NoteForm leadId={lead.id} />
                {!lead.converted && <Convert leadId={lead.id} learners={learners} />}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function StagePicker({ id, stage }: { id: string; stage: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <select
      value={stage}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          await setLeadStage(id, e.target.value as (typeof STAGES)[number]);
          router.refresh();
        })
      }
      aria-label="Stage"
      className="h-8 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 text-[0.8125rem] capitalize"
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {s.toLowerCase().replace('_', ' ')}
        </option>
      ))}
    </select>
  );
}

function Claim({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await claimLead(id);
          router.refresh();
        })
      }
    >
      {pending ? 'Claiming...' : 'Claim'}
    </Button>
  );
}

function CompleteFollowUp({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      className="ml-2 underline"
      onClick={() =>
        start(async () => {
          await completeFollowUp(id);
          router.refresh();
        })
      }
    >
      done
    </button>
  );
}

function NoteForm({ leadId }: { leadId: string }) {
  const [state, action, pending] = useActionState(addLeadNote, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />
      <FormError message={state.error} />

      <Field label="What happened">
        <Select name="type" defaultValue="CALL">
          <option value="CALL">Called</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="EMAIL">Emailed</option>
          <option value="NOTE">Note only</option>
        </Select>
      </Field>

      <Field label="Notes">
        <Textarea name="body" rows={2} required maxLength={2000} />
      </Field>

      <Field label="Follow up on" hint="Optional. Overdue ones are counted at the top.">
        <Input name="followUpAt" type="date" />
      </Field>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving...' : 'Log it'}
      </Button>
    </form>
  );
}

function Convert({
  leadId,
  learners,
}: {
  leadId: string;
  learners: { id: string; name: string; email: string | null }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-3">
      <Field
        label="They enrolled as"
        hint="Links this enquiry to the learner it became, which is what makes source attribution real."
      >
        <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Not yet</option>
          {learners.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} {l.email ? `· ${l.email}` : ''}
            </option>
          ))}
        </Select>
      </Field>

      {error && <p className="t-small text-[var(--bad)]">{error}</p>}

      <Button
        size="sm"
        disabled={pending || !userId}
        onClick={() =>
          start(async () => {
            const res = await linkLeadToLearner(leadId, userId);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        {pending ? 'Linking...' : 'Mark won'}
      </Button>
    </div>
  );
}
