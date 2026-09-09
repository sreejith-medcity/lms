'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteModule, saveModule } from '@/server/catalogue';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function ModuleForm({
  module,
  onDone,
}: {
  module?: { id: string; name: string; description: string | null };
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(saveModule, initial);
  const router = useRouter();

  if (state.ok) {
    setTimeout(() => {
      router.refresh();
      onDone?.();
    }, 0);
  }

  return (
    <form action={action} className="space-y-4">
      {module && <input type="hidden" name="id" value={module.id} />}
      <FormError message={state.error} />
      {!onDone && <FormSuccess message={state.ok ? state.message : undefined} />}

      <Field label="Name">
        <Input name="name" defaultValue={module?.name} required maxLength={120} placeholder="A1 Grammar" />
      </Field>

      <Field label="Description" hint="For your team, not learners">
        <Textarea name="description" defaultValue={module?.description ?? ''} rows={2} maxLength={500} />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : module ? 'Save' : 'Create module'}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function ModuleRow({
  module,
  usedBy,
}: {
  module: { id: string; name: string; description: string | null };
  usedBy: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  if (editing) return <ModuleForm module={module} onDone={() => setEditing(false)} />;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium">{module.name}</p>
        {module.description && <p className="t-small muted mt-0.5">{module.description}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          Rename
        </Button>
        {usedBy === 0 && (
          <Button
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteModule(module.id);
                setError(res.error);
                if (!res.error) router.refresh();
              })
            }
          >
            Delete
          </Button>
        )}
        {error && <span className="t-small text-[var(--bad)]">{error}</span>}
      </div>
    </div>
  );
}
