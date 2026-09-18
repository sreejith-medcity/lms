'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveBranch, setBranchActive } from '@/server/settings';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

interface Branch {
  id: string;
  name: string;
  code: string;
  city: string | null;
  state: string | null;
  addressLine: string | null;
  isActive: boolean;
  kind: 'PHYSICAL' | 'VIRTUAL';
  headUserId: string | null;
  deputyUserId: string | null;
  _count: { batches: number; enrollments: number };
}

interface Staff {
  id: string;
  name: string;
}

export function BranchList({ branches, staff }: { branches: Branch[]; staff: Staff[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.name ?? null;

  return (
    <div className="space-y-3">
      {branches.map((b) =>
        editing === b.id ? (
          <Card key={b.id}>
            <BranchForm branch={b} staff={staff} onDone={() => setEditing(null)} />
          </Card>
        ) : (
          <Card key={b.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{b.name}</p>
                  <Badge tone="neutral">{b.code}</Badge>
                  {b.kind === 'VIRTUAL' && <Badge tone="neutral">virtual</Badge>}
                  {!b.isActive && <Badge tone="warn">inactive</Badge>}
                </div>
                <p className="t-small faint mt-1">
                  {b.kind === 'VIRTUAL'
                    ? 'Online batches; no address'
                    : [b.addressLine, b.city, b.state].filter(Boolean).join(', ') || 'No address set'}
                </p>
                <p className="t-small faint mt-1">
                  {nameOf(b.headUserId) ? `Head: ${nameOf(b.headUserId)}` : 'No Branch Head named'}
                  {nameOf(b.deputyUserId) ? ` · Deputy: ${nameOf(b.deputyUserId)}` : ''}
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

export function BranchForm({ branch, staff, onDone }: { branch?: Branch; staff: Staff[]; onDone?: () => void }) {
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

      <Field label="Kind" hint="A virtual branch is where online batches live. It has a head and an approval queue like any other.">
        <Select name="kind" defaultValue={branch?.kind ?? 'PHYSICAL'}>
          <option value="PHYSICAL">Physical, with an address</option>
          <option value="VIRTUAL">Virtual, for online batches</option>
        </Select>
      </Field>

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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Branch Head" hint="Approves this branch's results. Give them the Branch Head role and membership of this branch too.">
          <Select name="headUserId" defaultValue={branch?.headUserId ?? ''}>
            <option value="">Not named yet</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Deputy" hint="Covers approvals when the head is away.">
          <Select name="deputyUserId" defaultValue={branch?.deputyUserId ?? ''}>
            <option value="">Nobody</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
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
