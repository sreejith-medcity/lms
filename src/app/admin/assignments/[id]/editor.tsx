'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addBriefFiles, archiveAssignment, removeBriefFile, saveAssignment } from '@/server/assignments';
import type { ActionState } from '@/server/courses';
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState & { id?: string } = {};

export interface CourseOption {
  id: string;
  title: string;
  batches: { id: string; name: string }[];
}

export interface AssignmentDraft {
  id?: string;
  courseId: string;
  batchId: string | null;
  title: string;
  instructions: string;
  maxMarks: number;
  /** As the datetime-local input wants it, already in the academy's zone. */
  dueAtLocal: string;
  acceptLate: boolean;
  allowResubmit: boolean;
  requireText: boolean;
  requireFile: boolean;
  status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED';
  hasHandIns: boolean;
}

export function AssignmentEditor({ courses, draft, canDelete }: { courses: CourseOption[]; draft: AssignmentDraft; canDelete: boolean }) {
  const [state, action, pending] = useActionState(saveAssignment, initial);
  const router = useRouter();
  const [courseId, setCourseId] = useState(draft.courseId || courses[0]?.id || '');
  const batches = courses.find((c) => c.id === courseId)?.batches ?? [];

  useEffect(() => {
    if (state.ok && state.id && !draft.id) router.replace(`/admin/assignments/${state.id}`);
    else if (state.ok) router.refresh();
  }, [state, draft.id, router]);

  return (
    <form action={action} className="space-y-5">
      {draft.id && <input type="hidden" name="id" value={draft.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Title">
        <Input name="title" required maxLength={160} defaultValue={draft.title} placeholder="Write a formal letter of complaint" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Course" hint={draft.hasHandIns ? 'Fixed once work has been handed in.' : undefined}>
          <Select name="courseId" value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={draft.hasHandIns} required>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
          {draft.hasHandIns && <input type="hidden" name="courseId" value={courseId} />}
        </Field>
        <Field label="Batch" hint="Leave on every batch for self-paced learners and for homework the whole course shares.">
          <Select name="batchId" defaultValue={draft.batchId ?? ''}>
            <option value="">Every batch</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="The brief" hint="What to do, how long it should be, what a good answer looks like. Files go below once the assignment is saved.">
        <Textarea name="instructions" rows={8} maxLength={20_000} defaultValue={draft.instructions} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Marks out of">
          <Input name="maxMarks" type="number" min={1} max={10_000} step="0.5" defaultValue={draft.maxMarks} required />
        </Field>
        <Field label="Due" hint="In the academy's own time. Blank means no deadline.">
          <Input name="dueAt" type="datetime-local" defaultValue={draft.dueAtLocal} />
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={draft.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'}>
            <option value="DRAFT">Draft, hidden from learners</option>
            <option value="PUBLISHED">Open to learners</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Checkbox name="acceptLate" label="Accept late work" hint="Taken after the due date and flagged late. Off means the door shuts at the deadline." defaultChecked={draft.acceptLate} />
        <Checkbox name="allowResubmit" label="Allow a second hand-in" hint="After marking, the learner may try again. Work you return for another go can always be resubmitted." defaultChecked={draft.allowResubmit} />
        <Checkbox name="requireText" label="A written answer is required" defaultChecked={draft.requireText} />
        <Checkbox name="requireFile" label="A file is required" hint="A document, a photo of handwritten work, a recording." defaultChecked={draft.requireFile} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : draft.id ? 'Save' : 'Create'}
        </Button>
        {draft.id && canDelete && <Archive id={draft.id} />}
        {!draft.id && <p className="t-small faint">Learners are told the first time it is opened, not on later edits.</p>}
      </div>
    </form>
  );
}

function Archive({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <Button type="button" variant="ghost" onClick={() => setConfirm(true)}>
        Archive
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="t-small muted">Hide it from learners? Hand-ins are kept.</span>
      <Button
        type="button"
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await archiveAssignment(id);
            if (r.ok) router.push('/admin/assignments');
          })
        }
      >
        Yes, archive
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(false)}>
        Keep
      </Button>
    </span>
  );
}

export function BriefFiles({
  assignmentId,
  files,
  canEdit,
}: {
  assignmentId: string;
  files: { assetId: string; name: string; size: string }[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(addBriefFiles, initial);
  const router = useRouter();
  const [removing, startRemove] = useTransition();

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="space-y-3">
      {files.length === 0 ? (
        <p className="t-small faint">No files with the brief.</p>
      ) : (
        <ul className="divide-y rounded-[var(--radius-sm)] border">
          {files.map((f) => (
            <li key={f.assetId} className="flex items-center justify-between gap-3 px-3 py-2">
              <a href={`/api/assets/${f.assetId}`} target="_blank" rel="noreferrer" className="t-small min-w-0 truncate hover:underline">
                {f.name}
              </a>
              <span className="t-micro faint shrink-0">{f.size}</span>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  disabled={removing}
                  onClick={() =>
                    startRemove(async () => {
                      await removeBriefFile(assignmentId, f.assetId);
                      router.refresh();
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <FormError message={state.error} />
          <label className="t-small block">
            <span className="faint block">Add files, up to 25 MB each</span>
            <input name="files" type="file" multiple className="mt-1 block text-sm" />
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? 'Uploading...' : 'Upload'}
          </Button>
        </form>
      )}
    </div>
  );
}
