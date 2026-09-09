'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveBranch, setBranchActive } from '@/server/settings';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

interface Branch {
  id: string;
  name: string;
  code: string;
  city: string | null;
  state: string | null;
  addressLine: string | null;
  isActive: boolean;
  _count: { batches: number; enrollments: number };
}

export function BranchList({ branches }: { branches: Branch[] }) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {branches.map((b) =>
        editing === b.id ? (
          <Card key={b.id}>
            <BranchForm branch={b} onDone={() => setEditing(null)} />
          </Card>
        ) : (
          <Card key={b.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{b.name}</p>
                  <Badge tone="neutral">{b.code}</Badge>
                  {!b.isActive && <Badge tone="warn">inactive</Badge>}
                </div>
                <p className="t-small faint mt-1">
                  {[b.addressLine, b.city, b.state].filter(Boolean).join(', ') || 'No address set'}
                </p>
                <p className="t-small faint mt-1 tabular-nums">
                  {b._count.batches} batch{b._count.batches === 1 ? '' : 'es'} ·{' '}
                  {b._count.enrollments} enrolment{b._count.enrollments === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditing(b.id)}>
                  Edit
                </Button>
                <ToggleActive id={b.id} isActive={b.isActive} />
              </div>
            </div>
          </Card>
        ),
      )}
    </div>
  );
}

function ToggleActive({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="text-right">
      <Button
        variant={isActive ? 'secondary' : 'primary'}
        size="sm"
        disabled={pending}
        title={
          isActive
            ? 'Hides it from every picker. Nothing is deleted, because batches and orders point at it.'
            : undefined
        }
        onClick={() =>
          start(async () => {
            const res = await setBranchActive(id, !isActive);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        {isActive ? 'Deactivate' : 'Reactivate'}
      </Button>
      {error && <p className="t-small mt-1 max-w-52 text-[var(--bad)]">{error}</p>}
    </div>
  );
}

export function BranchForm({ branch, onDone }: { branch?: Branch; onDone?: () => void }) {
  const [state, action, pending] = useActionState(saveBranch, initial);
  const router = useRouter();

  if (state.ok && onDone) {
    // Saved from the inline editor: close it and pull fresh data.
    setTimeout(() => {
      onDone();
      router.refresh();
    }, 0);
  }

  return (
    <form action={action} className="space-y-4">
      {branch && <input type="hidden" name="id" value={branch.id} />}
      <FormError message={state.error} />
      {!onDone && <FormSuccess message={state.ok ? state.message : undefined} />}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Branch name">
          <Input name="name" defaultValue={branch?.name} required maxLength={120} placeholder="Kannur" />
        </Field>
        <Field label="Code" hint="Short, unique">
          <Input name="code" defaultValue={branch?.code} required maxLength={20} placeholder="KNR" />
        </Field>
      </div>

      <Field label="Address">
        <Input name="addressLine" defaultValue={branch?.addressLine ?? ''} maxLength={240} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City">
          <Input name="city" defaultValue={branch?.city ?? ''} />
        </Field>
        <Field label="State">
          <Input name="state" defaultValue={branch?.state ?? ''} />
        </Field>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : branch ? 'Save branch' : 'Add branch'}
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
