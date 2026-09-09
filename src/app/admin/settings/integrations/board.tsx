'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveIntegration, disconnectIntegration, testIntegration } from '@/server/integrations';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

export interface FieldRow {
  key: string;
  label: string;
  kind: string;
  hint: string | null;
  placeholder: string | null;
  env: string | null;
  filled: boolean;
  fromEnv: boolean;
  tail: string | null;
  value: string | null;
}

export interface IntegrationRow {
  id: string;
  name: string;
  purpose: string;
  status: string;
  landsIn: string | null;
  docsUrl: string | null;
  fallback: string | null;
  envOnly: boolean;
  fields: FieldRow[];
  complete: boolean;
  fromEnvCount: number;
}

export function IntegrationBoard({
  categories,
  canEdit,
}: {
  categories: { key: string; label: string; blurb: string; items: IntegrationRow[] }[];
  canEdit: boolean;
}) {
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<'all' | 'connected' | 'available'>('all');

  const needle = query.trim().toLowerCase();

  const shown = useMemo(
    () =>
      categories
        .map((c) => ({
          ...c,
          items: c.items.filter((i) => {
            if (only === 'connected' && !i.complete) return false;
            if (only === 'available' && i.status !== 'wired') return false;
            if (!needle) return true;
            return `${i.name} ${i.purpose} ${c.label}`.toLowerCase().includes(needle);
          }),
        }))
        .filter((c) => c.items.length > 0),
    [categories, needle, only],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <Input
            type="search"
            value={query}
            placeholder="Search — try whatsapp, or accounting"
            aria-label="Search integrations"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="flex rounded-[var(--radius-sm)] border p-0.5">
          {([
            ['all', 'Everything'],
            ['available', 'Ready to use'],
            ['connected', 'Connected'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setOnly(value)}
              className={`rounded-[calc(var(--radius-sm)-2px)] px-3 py-1.5 text-sm transition ${
                only === value
                  ? 'bg-[var(--brand)] font-medium text-[var(--brand-ink)]'
                  : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && (
        <Card>
          <p className="t-small muted">Nothing matches that.</p>
        </Card>
      )}

      {shown.map((category) => (
        <section key={category.key} className="space-y-3">
          <div>
            <h2 className="t-heading">{category.label}</h2>
            <p className="t-small muted">{category.blurb}</p>
          </div>

          <div className="grid gap-3">
            {category.items.map((item) => (
              <IntegrationCard key={item.id} item={item} canEdit={canEdit} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function IntegrationCard({ item, canEdit }: { item: IntegrationRow; canEdit: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveIntegration, initial);
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [result, setResult] = useState<ActionState>({});

  const anythingStored = item.fields.some((f) => f.filled && !f.fromEnv);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-prose">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {item.name}
            {item.complete && item.status === 'wired' && <Badge tone="ok">connected</Badge>}
            {item.complete && item.status === 'planned' && <Badge tone="brand">keys stored</Badge>}
            {!item.complete && <Badge tone="neutral">not connected</Badge>}
            {item.status === 'planned' && <Badge tone="warn">code lands in {item.landsIn}</Badge>}
            {item.fromEnvCount > 0 && <Badge tone="neutral">set in the environment</Badge>}
          </p>

          <p className="t-small muted mt-1">{item.purpose}</p>

          {!item.complete && item.fallback && (
            <p className="t-small faint mt-1">{item.fallback}</p>
          )}

          {item.status === 'planned' && (
            <p className="t-small faint mt-1">
              You can put the keys in now and they will be sealed and waiting, but nothing reads
              them until {item.landsIn}.
            </p>
          )}

          {item.envOnly && (
            <p className="t-small faint mt-1">
              This one runs today, but from the environment rather than from here. What you type is
              stored and sealed; the deployment keeps using its own values until Phase 7 threads
              these through per academy. Payments are not something to refactor casually.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {item.docsUrl && (
            <a
              href={item.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="t-small faint hover:underline"
            >
              Where to find these
            </a>
          )}
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? 'Close' : item.complete ? 'Edit' : 'Connect'}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <form action={action} className="mt-4 space-y-3 border-t pt-4">
          <input type="hidden" name="provider" value={item.id} />

          <div className="grid gap-3 sm:grid-cols-2">
            {item.fields.map((field) => (
              <Field
                key={field.key}
                label={field.label}
                hint={
                  field.fromEnv
                    ? `Set in the environment as ${field.env}. That value wins, and anything typed here is ignored until it is removed.`
                    : field.kind === 'secret' && field.filled
                      ? `Stored, ending ${field.tail}. Leave blank to keep it.`
                      : (field.hint ?? undefined)
                }
              >
                <Input
                  name={field.key}
                  type={field.kind === 'secret' ? 'password' : 'text'}
                  autoComplete="off"
                  disabled={field.fromEnv}
                  placeholder={
                    field.fromEnv
                      ? 'From the environment'
                      : field.kind === 'secret' && field.filled
                        ? '••••••••'
                        : (field.placeholder ?? '')
                  }
                />
              </Field>
            ))}
          </div>

          <FormError message={state.error ?? result.error} />
          <FormSuccess
            message={state.ok ? state.message : result.ok ? result.message : undefined}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Sealing…' : 'Save'}
            </Button>

            {item.complete && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    setResult(await testIntegration(item.id));
                    router.refresh();
                  })
                }
              >
                {busy ? 'Checking…' : 'Test it'}
              </Button>
            )}

            {anythingStored && (
              <button
                type="button"
                className="t-small faint hover:text-[var(--bad)]"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    setResult(await disconnectIntegration(item.id));
                    router.refresh();
                  })
                }
              >
                Disconnect
              </button>
            )}
          </div>

          <p className="t-micro faint">
            Secrets are encrypted before they are written and never shown again, so this form can
            only ever replace one, not read it back.
          </p>
        </form>
      )}
    </Card>
  );
}
