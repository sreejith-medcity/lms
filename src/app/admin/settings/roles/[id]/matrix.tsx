'use client';

import { useActionState, useMemo, useState } from 'react';
import { saveRolePermissions } from '@/server/team';
import type { ActionState } from '@/server/courses';
import { Button, Card, Checkbox, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

type Action = 'view' | 'edit' | 'delete';

interface Group {
  group: string;
  label: string;
  items: { key: string; label: string }[];
}

type Grants = Record<string, { view: boolean; edit: boolean; delete: boolean }>;

/**
 * Thirty permission groups, each with view, edit and delete.
 *
 * Two rules are enforced as you click, and again on the server: ticking edit
 * ticks view, and ticking delete ticks both. A role that can delete a payment
 * but cannot see one is a nonsense, and the honest place to prevent it is here,
 * not in a validation message afterwards.
 */
export function PermissionMatrix({
  roleId,
  readOnly,
  restrictBatchAccess,
  groups,
  current,
}: {
  roleId: string;
  readOnly: boolean;
  restrictBatchAccess: boolean;
  groups: Group[];
  current: Grants;
}) {
  const [state, action, pending] = useActionState(saveRolePermissions, initial);
  const [grants, setGrants] = useState<Grants>(current);
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) => i.label.toLowerCase().includes(q) || g.label.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, filter]);

  const granted = Object.values(grants).filter((g) => g.view || g.edit || g.delete).length;

  function set(key: string, action: Action, value: boolean) {
    setGrants((all) => {
      const row = all[key] ?? { view: false, edit: false, delete: false };
      const next = { ...row };

      if (action === 'view') {
        next.view = value;
        if (!value) {
          next.edit = false;
          next.delete = false;
        }
      }
      if (action === 'edit') {
        next.edit = value;
        if (value) next.view = true;
        else next.delete = false;
      }
      if (action === 'delete') {
        next.delete = value;
        if (value) {
          next.edit = true;
          next.view = true;
        }
      }

      return { ...all, [key]: next };
    });
  }

  function setGroup(group: Group, value: boolean) {
    setGrants((all) => {
      const next = { ...all };
      for (const item of group.items) {
        next[item.key] = value
          ? { view: true, edit: true, delete: false }
          : { view: false, edit: false, delete: false };
      }
      return next;
    });
  }

  return (
    <form action={action}>
      <input type="hidden" name="roleId" value={roleId} />

      <div className="sticky top-0 z-10 -mx-1 mb-4 flex flex-wrap items-center gap-3 bg-[var(--canvas)] px-1 py-3">
        <div className="min-w-56 flex-1">
          <Input
            placeholder="Find a permission"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Find a permission"
          />
        </div>
        <span className="t-small faint tabular-nums">{granted} granted</span>
        {!readOnly && (
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving...' : 'Save permissions'}
          </Button>
        )}
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      {readOnly && (
        <p className="t-small mb-4 rounded-[var(--radius-sm)] border border-dashed p-3 text-[var(--warn)]">
          This is a built-in role and cannot be changed. Copy it from the roles list and edit the
          copy.
        </p>
      )}

      {!readOnly && (
        <div className="mb-4">
          <Checkbox
            name="restrictBatchAccess"
            label="Only their own batches"
            hint="They see batches where they are the tutor or manager, and every list in the app filters through it."
            defaultChecked={restrictBatchAccess}
          />
        </div>
      )}

      <div className="space-y-3">
        {visible.map((g) => (
          <Card key={g.group} padded={false}>
            <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
              <h3 className="text-sm font-semibold">{g.label}</h3>
              {!readOnly && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="t-small faint hover:underline"
                    onClick={() => setGroup(g, true)}
                  >
                    Allow all
                  </button>
                  <button
                    type="button"
                    className="t-small faint hover:underline"
                    onClick={() => setGroup(g, false)}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-[var(--surface-2)]">
                  <th className="t-micro faint px-5 py-2 text-left font-semibold">Permission</th>
                  {(['view', 'edit', 'delete'] as Action[]).map((a) => (
                    <th
                      key={a}
                      className="t-micro faint w-20 px-2 py-2 text-center font-semibold capitalize"
                    >
                      {a}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.items.map((item) => {
                  const row = grants[item.key] ?? { view: false, edit: false, delete: false };
                  return (
                    <tr key={item.key} className="border-b last:border-0">
                      <td className="px-5 py-2">{item.label}</td>
                      {(['view', 'edit', 'delete'] as Action[]).map((a) => (
                        <td key={a} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            name={`${item.key}:${a}`}
                            checked={row[a]}
                            disabled={readOnly}
                            onChange={(e) => set(item.key, a, e.target.checked)}
                            aria-label={`${item.label}: ${a}`}
                            className="h-4 w-4 accent-[var(--brand)] disabled:opacity-50"
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="t-small faint py-8 text-center">Nothing matches that.</p>
      )}
    </form>
  );
}
