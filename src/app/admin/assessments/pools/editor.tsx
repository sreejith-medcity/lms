'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { savePool } from '@/server/assessment-grants';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Checkbox } from '@/components/ui';

const initial: ActionState = {};

export function PoolEditor({
  assessments,
  pool,
}: {
  assessments: { id: string; title: string; kind: string }[];
  pool?: { id: string; name: string; description: string | null; assessmentIds: string[] };
}) {
  const [state, action, pending] = useActionState(savePool, initial);
  const [picked, setPicked] = useState<string[]>(pool?.assessmentIds ?? []);
  const [query, setQuery] = useState('');
  const router = useRouter();

  if (state.ok) setTimeout(() => router.refresh(), 0);

  const shown = query.trim()
    ? assessments.filter((a) => a.title.toLowerCase().includes(query.trim().toLowerCase()))
    : assessments;

  return (
    <form action={action} className="space-y-4">
      {pool && <input type="hidden" name="id" value={pool.id} />}
      {picked.map((id) => (
        <input key={id} type="hidden" name="assessmentIds" value={id} />
      ))}

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Name">
        <Input name="name" defaultValue={pool?.name} required maxLength={80} placeholder="NCLEX practice mocks" />
      </Field>

      <Field label="What it is" hint="Optional. Shown to whoever is granting it.">
        <Input name="description" defaultValue={pool?.description ?? ''} maxLength={200} />
      </Field>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="t-small font-medium">
            Tests in the set{picked.length > 0 ? ` (${picked.length})` : ''}
          </span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="max-w-[12rem]"
          />
        </div>

        <div className="mt-2 max-h-80 space-y-1 overflow-y-auto rounded-[var(--radius-sm)] border p-3">
          {shown.length === 0 ? (
            <p className="t-small faint">Nothing matches.</p>
          ) : (
            shown.map((a) => (
              <Checkbox
                key={a.id}
                name={`pick-${a.id}`}
                label={a.title}
                hint={a.kind.toLowerCase().replace('_', ' ')}
                checked={picked.includes(a.id)}
                onChange={(e) =>
                  setPicked((was) =>
                    e.target.checked ? [...was, a.id] : was.filter((id) => id !== a.id),
                  )
                }
              />
            ))
          )}
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : pool ? 'Save the set' : 'Make the set'}
      </Button>
    </form>
  );
}
