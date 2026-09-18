'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { previewNoticeAudience, saveNotice, searchNoticeLearners, type AudiencePreview } from '@/server/notices';
import type { ActionState } from '@/server/courses';
import { NOTICE_KINDS } from '@/lib/notices';
import { Button, Checkbox, Field, FormError, Input, Select, Textarea } from '@/components/ui';

export interface NoticeFormValues {
  id?: string;
  kind: string;
  title: string;
  body: string;
  everyone: boolean;
  branchIds: string[];
  batchIds: string[];
  learners: { id: string; name: string }[];
  toParents: boolean;
  toLearners: boolean;
  meetingAt: string;
  meetingEndsAt: string;
  venue: string;
  link: string;
  instructions: string;
  correction: boolean;
}

const initial: ActionState = {};

/**
 * The notice form. The audience is picked here and counted here, before
 * anything is saved: the "who gets this" line at the bottom is the same
 * resolver the publish will use, so the count is a promise, not a guess.
 */
export function NoticeForm({
  values,
  branches,
  batches,
  canReachAll,
  timezone,
}: {
  values: NoticeFormValues;
  branches: { id: string; name: string }[];
  batches: { id: string; name: string; branchId: string }[];
  canReachAll: boolean;
  timezone: string;
}) {
  const [state, action, pending] = useActionState(saveNotice, initial);
  const [kind, setKind] = useState(values.kind);
  const [everyone, setEveryone] = useState(values.everyone);
  const [branchIds, setBranchIds] = useState<string[]>(values.branchIds);
  const [batchIds, setBatchIds] = useState<string[]>(values.batchIds);
  const [learners, setLearners] = useState(values.learners);
  const [toParents, setToParents] = useState(values.toParents);
  const [toLearners, setToLearners] = useState(values.toLearners);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [counting, startCount] = useTransition();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; name: string; registrationNo: number | null }[]>([]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const spec = useMemo(
    () => ({ everyone, branchIds, batchIds, learnerIds: learners.map((l) => l.id), toParents, toLearners }),
    [everyone, branchIds, batchIds, learners, toParents, toLearners],
  );

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => searchNoticeLearners(q).then(setHits), 250);
    return () => clearTimeout(t);
  }, [q]);

  function count() {
    startCount(async () => setPreview(await previewNoticeAudience(spec)));
  }

  const visibleBatches = branchIds.length ? batches.filter((b) => !branchIds.includes(b.branchId)) : batches;

  return (
    <form action={action} className="space-y-5">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <FormError message={state.error} />

      {values.correction && (
        <p className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn)' }}>
          This is a correction. When published it replaces the earlier version in every inbox, marked as a correction, and the earlier one is kept on record.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <Field label="Kind">
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {NOTICE_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" hint="As it appears on the phone">
          <Input name="title" required maxLength={160} defaultValue={values.title} placeholder="Parent-teacher meeting, Saturday 3 October" />
        </Field>
      </div>

      <Field label="Message">
        <Textarea name="body" required rows={7} maxLength={6000} defaultValue={values.body} placeholder="Plain words. Say what, when, where and what the parent should do." />
      </Field>

      {kind === 'MEETING' && (
        <div className="rounded-[var(--radius-sm)] border p-4">
          <p className="t-small font-medium">Meeting details</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Starts" hint={`Time in ${timezone}`}>
              <Input type="datetime-local" name="meetingAt" required defaultValue={values.meetingAt} />
            </Field>
            <Field label="Ends" hint="Optional">
              <Input type="datetime-local" name="meetingEndsAt" defaultValue={values.meetingEndsAt} />
            </Field>
            <Field label="Venue" hint="For a meeting at the branch">
              <Input name="venue" maxLength={200} defaultValue={values.venue} placeholder="Kochi branch, room 2" />
            </Field>
            <Field label="Link" hint="For an online meeting">
              <Input name="link" type="url" maxLength={500} defaultValue={values.link} placeholder="https://" />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Instructions" hint="What to bring, whom to ask for, how to join">
              <Textarea name="instructions" rows={2} maxLength={1000} defaultValue={values.instructions} />
            </Field>
          </div>
        </div>
      )}

      <div className="rounded-[var(--radius-sm)] border p-4">
        <p className="t-small font-medium">Who gets it</p>
        <p className="t-small faint mt-0.5">Pick any mix. A learner reached by two groups is counted once; a parent with two children here gets one notice naming both.</p>

        <div className="mt-3 space-y-3">
          {canReachAll && (
            <Checkbox name="everyone" label="Everyone in the academy" hint="Every active learner, and their linked parents." checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
          )}

          {!everyone && (
            <>
              {branches.length > 0 && (
                <div>
                  <p className="t-small">Branches</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {branches.map((b) => (
                      <label key={b.id} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${branchIds.includes(b.id) ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : ''}`}>
                        <input type="checkbox" name="branchIds" value={b.id} className="sr-only" checked={branchIds.includes(b.id)} onChange={() => toggle(branchIds, setBranchIds, b.id)} />
                        {b.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="t-small">Batches{branchIds.length ? ' (outside the branches already picked)' : ''}</p>
                {visibleBatches.length === 0 ? (
                  <p className="t-small faint mt-1">None to add.</p>
                ) : (
                  <div className="mt-1.5 flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                    {visibleBatches.map((b) => (
                      <label key={b.id} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${batchIds.includes(b.id) ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : ''}`}>
                        <input type="checkbox" name="batchIds" value={b.id} className="sr-only" checked={batchIds.includes(b.id)} onChange={() => toggle(batchIds, setBatchIds, b.id)} />
                        {b.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="t-small">Particular learners</p>
                {learners.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {learners.map((l) => (
                      <span key={l.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--brand)] bg-[var(--brand-soft)] px-3 py-1 text-sm">
                        <input type="hidden" name="learnerIds" value={l.id} />
                        {l.name}
                        <button type="button" aria-label={`Remove ${l.name}`} className="ml-1 text-xs" onClick={() => setLearners(learners.filter((x) => x.id !== l.id))}>
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative mt-1.5 max-w-sm">
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or registration number" />
                  {hits.length > 0 && (
                    <ul className="absolute z-10 mt-1 w-full rounded-[var(--radius-sm)] border bg-[var(--surface)] shadow">
                      {hits.map((h) => (
                        <li key={h.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]"
                            onClick={() => {
                              if (!learners.some((l) => l.id === h.id)) setLearners([...learners, { id: h.id, name: h.name }]);
                              setQ('');
                              setHits([]);
                            }}
                          >
                            {h.name}
                            {h.registrationNo ? <span className="faint"> · {h.registrationNo}</span> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <Checkbox name="toParents" label="To parents" hint="Their inbox, push, and the channels set for notices." checked={toParents} onChange={(e) => setToParents(e.target.checked)} />
            <Checkbox name="toLearners" label="To learners as well" hint="Their bell and the same channels." checked={toLearners} onChange={(e) => setToLearners(e.target.checked)} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3">
          <Button type="button" variant="secondary" size="sm" disabled={counting} onClick={count}>
            {counting ? 'Counting...' : 'Count who gets this'}
          </Button>
          {preview && <p className={`t-small ${preview.ok ? '' : 'text-[var(--bad)]'}`}>{preview.line}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : values.id ? 'Save draft' : 'Save as draft'}
        </Button>
        <p className="t-small faint">Nothing is sent until you press Publish on the next screen, where the count is shown again.</p>
      </div>
    </form>
  );
}
