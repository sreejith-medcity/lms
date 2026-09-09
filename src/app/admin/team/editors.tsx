'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addTeamMember, setMemberRole, setMemberStatus } from '@/server/team';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, Input, Select } from '@/components/ui';

const initial: ActionState & { temporaryPassword?: string } = {};

export function AddMemberForm({
  roles,
  branches,
}: {
  roles: { id: string; name: string }[];
  branches: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(addTeamMember, initial);
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  if (state.ok && state.temporaryPassword) {
    return (
      <div className="space-y-4">
        <p className="t-small">{state.message}</p>

        <div className="rounded-[var(--radius)] border bg-[var(--surface-2)] p-4">
          <p className="t-micro faint uppercase tracking-wide">One-time password</p>
          <code className="mt-2 block break-all font-mono text-base">
            {state.temporaryPassword}
          </code>
          <button
            type="button"
            className="t-small mt-3 underline"
            onClick={() => {
              navigator.clipboard?.writeText(state.temporaryPassword ?? '');
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <p className="t-small faint">
          This is the only time it is shown. If it is lost, remove the person and add them again.
        </p>

        <Button
          onClick={() => {
            router.refresh();
            window.location.reload();
          }}
        >
          Add another
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />

      <Field label="Name">
        <Input name="name" required maxLength={120} autoComplete="off" />
      </Field>

      <Field label="Email" hint="This is what they sign in with">
        <Input name="email" type="email" required autoComplete="off" />
      </Field>

      <Field label="Phone">
        <Input name="phone" type="tel" maxLength={20} autoComplete="off" />
      </Field>

      <Field label="Role">
        <Select name="roleId" required defaultValue="">
          <option value="" disabled>
            Choose a role
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>

      {branches.length > 0 && (
        <Field label="Branch" hint="Leave blank for every branch">
          <Select name="branchId" defaultValue="">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding...' : 'Add to team'}
      </Button>
    </form>
  );
}

export function MemberControls({
  userId,
  roles,
  currentRoleId,
  status,
}: {
  userId: string;
  roles: { id: string; name: string }[];
  currentRoleId: string;
  status: 'ACTIVE' | 'SUSPENDED';
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-1.5">
      <select
        value={currentRoleId}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const res = await setMemberRole(userId, e.target.value);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
        className="h-8 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 text-[0.8125rem]"
        aria-label="Role"
      >
        {currentRoleId === '' && <option value="">No role</option>}
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        disabled={pending}
        className="t-small faint block hover:underline"
        onClick={() =>
          start(async () => {
            const res = await setMemberStatus(userId, status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        {status === 'ACTIVE' ? 'Suspend access' : 'Restore access'}
      </button>

      {error && <p className="t-small text-[var(--bad)]">{error}</p>}
    </div>
  );
}
