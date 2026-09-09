'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addRedirect, importRedirects, removeRedirect, type ImportState } from '@/server/redirects';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ImportState = {};
const initialAction: ActionState = {};

export interface Rule {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  hitCount: number;
}

export function RedirectBoard({
  rules,
  canEdit,
  canDelete,
}: {
  rules: Rule[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [added, addAction, adding] = useActionState(addRedirect, initialAction);
  const [imported, importAction, importing] = useActionState(importRedirects, initial);
  const [query, setQuery] = useState('');
  const [busy, start] = useTransition();
  const [result, setResult] = useState<ActionState>({});

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle
        ? rules.filter((rule) =>
            `${rule.fromPath} ${rule.toPath}`.toLowerCase().includes(needle),
          )
        : rules,
    [rules, needle],
  );

  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <p className="font-medium">Add one</p>
            <p className="t-small muted mt-1">
              Paths, not full URLs, though a pasted URL is trimmed for you. End both sides with
              <span className="font-mono"> /* </span>
              to move a whole tree and carry the rest of the path across.
            </p>

            <form action={addAction} className="mt-3 space-y-3">
              <Field label="Old path" hint="/shop/ielts-coaching-kochi">
                <Input name="fromPath" required />
              </Field>
              <Field label="Goes to" hint="/courses/ielts-kochi">
                <Input name="toPath" required />
              </Field>
              <Field label="Kind" hint="Permanent unless the page is genuinely coming back.">
                <select
                  name="statusCode"
                  className="w-full rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2 text-sm"
                  defaultValue="301"
                >
                  <option value="301">Permanent</option>
                  <option value="302">Temporary</option>
                </select>
              </Field>
              <FormError message={added.error} />
              <FormSuccess message={added.ok ? added.message : undefined} />
              <Button type="submit" disabled={adding}>
                {adding ? 'Saving...' : 'Add'}
              </Button>
            </form>
          </Card>

          <Card>
            <p className="font-medium">Paste a list</p>
            <p className="t-small muted mt-1">
              One rule per line, old path then new, separated by a comma, a tab or a space. A CSV
              export or two columns out of a spreadsheet both work.
            </p>

            <form action={importAction} className="mt-3 space-y-3">
              <Field label="Rules">
                <textarea
                  name="rules"
                  rows={7}
                  className="w-full rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                  placeholder={'/shop/*, /courses/*\n/product/ielts-kochi, /courses/ielts-kochi'}
                />
              </Field>
              <FormError message={imported.error} />
              <FormSuccess message={imported.ok ? imported.message : undefined} />

              {imported.skipped && imported.skipped.length > 0 && (
                <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3">
                  <p className="t-small font-medium">Left out, and why</p>
                  <ul className="t-small muted mt-1 space-y-1">
                    {imported.skipped.map((row) => (
                      <li key={row.line}>
                        <span className="font-mono">{row.line}</span> — {row.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Button type="submit" disabled={importing}>
                {importing ? 'Checking...' : 'Import'}
              </Button>
            </form>
          </Card>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="t-heading">The map</h2>
            <p className="t-small muted">
              Most used first, which is also the order worth checking them in.
            </p>
          </div>
          <div className="w-full max-w-xs">
            <Input
              type="search"
              value={query}
              placeholder="Search a path"
              aria-label="Search redirects"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <FormError message={result.error} />
        <FormSuccess message={result.ok ? result.message : undefined} />

        {shown.length === 0 && (
          <Card>
            <p className="t-small muted">
              {rules.length === 0
                ? 'Nothing here yet. Until the old store is switched off this can wait, but not until after.'
                : 'Nothing matches that.'}
            </p>
          </Card>
        )}

        {shown.length > 0 && (
          <Card>
            <ul className="divide-y">
              {shown.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-baseline gap-2 py-2">
                  <span className="t-small font-mono">{rule.fromPath}</span>
                  <span className="faint">to</span>
                  <span className="t-small font-mono">{rule.toPath}</span>
                  {rule.statusCode !== 301 && <Badge tone="warn">temporary</Badge>}
                  {rule.fromPath.endsWith('/*') && <Badge tone="neutral">tree</Badge>}
                  <span className="t-small faint ml-auto">
                    {rule.hitCount === 0
                      ? 'never used'
                      : `${rule.hitCount} ${rule.hitCount === 1 ? 'visitor' : 'visitors'}`}
                  </span>
                  {canDelete && (
                    <button
                      type="button"
                      className="t-small faint hover:text-[var(--bad)]"
                      disabled={busy}
                      onClick={() =>
                        start(async () => {
                          setResult(await removeRedirect(rule.id));
                          router.refresh();
                        })
                      }
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
