'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeLearnerDocument, saveLearnerFields, uploadLearnerDocument } from '@/server/learner-fields';
import type { ActionState } from '@/server/courses';
import { Button, Card, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export interface StaffField {
  key: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  value: string;
}

export interface StaffDocument {
  key: string;
  label: string;
  required: boolean;
  file: { assetId: string; fileName: string; size: string; uploadedOn: string } | null;
}

/** The academy's own fields on a learner, editable by the office. */
export function LearnerFields({ learnerId, fields, canEdit }: { learnerId: string; fields: StaffField[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveLearnerFields, initial);
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  if (fields.length === 0) return <p className="t-small muted">No custom fields for learners yet. Add them under Settings, Custom fields.</p>;

  return (
    <Card>
      <form action={action} className="space-y-4">
        <input type="hidden" name="learnerId" value={learnerId} />
        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.required ? 'Required at signup' : undefined}>
              {f.type === 'DROPDOWN' ? (
                <Select name={`cf_${f.key}`} defaultValue={f.value} disabled={!canEdit}>
                  <option value="">Not set</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : f.type === 'MULTISELECT' ? (
                <Input name={`cf_${f.key}`} defaultValue={f.value} placeholder={f.options.join(', ')} maxLength={400} disabled={!canEdit} />
              ) : f.type === 'BOOLEAN' ? (
                <>
                  <input type="hidden" name="cf_booleans" value={f.key} />
                  <Checkbox name={`cf_${f.key}`} defaultChecked={f.value === 'true'} label="Yes" disabled={!canEdit} />
                </>
              ) : f.type === 'TEXT' && f.value.length > 80 ? (
                <Textarea name={`cf_${f.key}`} defaultValue={f.value} rows={2} maxLength={2000} disabled={!canEdit} />
              ) : (
                <Input name={`cf_${f.key}`} type={f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : 'text'} defaultValue={f.value} maxLength={2000} disabled={!canEdit} />
              )}
            </Field>
          ))}
        </div>
        {canEdit && (
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving...' : 'Save fields'}
          </Button>
        )}
      </form>
    </Card>
  );
}

/** The documents tab: one row per file field, with what is filed against it. */
export function LearnerDocuments({ learnerId, documents, canEdit }: { learnerId: string; documents: StaffDocument[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState(uploadLearnerDocument, initial);
  const router = useRouter();
  const [removing, startRemove] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      setTarget(null);
    }
  }, [state, router]);

  if (documents.length === 0) {
    return <p className="t-small muted">No document fields yet. Add a field of type "A file" under Settings, Custom fields (ID proof, photograph, certificate) and it appears here.</p>;
  }

  return (
    <Card padded={false}>
      <FormError message={state.error} />
      <ul className="divide-y">
        {documents.map((d) => (
          <li key={d.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <span className="min-w-0">
              <span className="t-small block font-medium">
                {d.label}
                {d.required && !d.file && <span className="ml-2 text-[var(--warn)]">missing</span>}
              </span>
              {d.file ? (
                <span className="t-small faint block truncate">
                  <a href={`/api/assets/${d.file.assetId}`} target="_blank" rel="noreferrer" className="underline">
                    {d.file.fileName}
                  </a>{' '}
                  · {d.file.size} · {d.file.uploadedOn}
                </span>
              ) : (
                <span className="t-small faint block">Nothing filed.</span>
              )}
            </span>
            {canEdit && (
              <span className="flex items-center gap-2">
                {target === d.key ? (
                  <form action={action} className="flex items-center gap-2">
                    <input type="hidden" name="learnerId" value={learnerId} />
                    <input type="hidden" name="key" value={d.key} />
                    <input name="file" type="file" required className="text-sm" />
                    <Button type="submit" size="sm" disabled={pending}>
                      {pending ? 'Uploading...' : 'Upload'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setTarget(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setTarget(d.key)}>
                      {d.file ? 'Replace' : 'Upload'}
                    </Button>
                    {d.file && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={removing}
                        onClick={() =>
                          startRemove(async () => {
                            await removeLearnerDocument(learnerId, d.key);
                            router.refresh();
                          })
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
