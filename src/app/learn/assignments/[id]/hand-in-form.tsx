'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { handIn } from '@/server/assignments';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Textarea } from '@/components/ui';
import { HAND_IN_MAX_FILES } from '@/lib/assignment-rules';

const initial: ActionState = {};

export function HandInForm({ assignmentId, requireText, requireFile, again }: { assignmentId: string; requireText: boolean; requireFile: boolean; again: boolean }) {
  const [state, action, pending] = useActionState(handIn, initial);
  const router = useRouter();
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={action} className="space-y-4 rounded-[var(--radius)] border bg-[var(--surface)] p-4">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label={requireText ? 'Your answer' : 'Your answer (optional if you attach a file)'}>
        <Textarea name="text" rows={10} maxLength={20_000} placeholder="Write here, or paste from your notes." required={requireText} />
      </Field>

      <Field label={requireFile ? 'Files' : 'Files (optional)'} hint={`Up to ${HAND_IN_MAX_FILES} files, 25 MB each. A photo of handwritten work is fine.`}>
        <input
          name="files"
          type="file"
          multiple
          required={requireFile}
          className="block text-sm"
          onChange={(e) => setNames(Array.from(e.target.files ?? []).map((f) => f.name))}
        />
        {names.length > 0 && <p className="t-micro faint mt-1">{names.join(', ')}</p>}
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? 'Sending...' : again ? 'Hand in again' : 'Hand in'}
      </Button>
    </form>
  );
}
