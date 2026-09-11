'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveIntegration,
  saveIntegrationMapping,
  disconnectIntegration,
  testIntegration,
} from '@/server/integrations';
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

export interface MappingRow {
  key: string;
  label: string;
  help: string | null;
  suggested: string | null;
  value: string;
}

export interface IntegrationRow {
  id: string;
  name: string;
  purpose: string;
  status: string;
  priority: number;
  landsIn: string | null;
  docsUrl: string | null;
  fallback: string | null;
  requires: string | null;
  alternativeTo: string | null;
  envOnly: boolean;
  fields: FieldRow[];
  mappings: MappingRow[];
  complete: boolean;
  fromEnvCount: number;
  lastAt: string | null;
  lastOk: boolean | null;
  lastAction: string | null;
  failures24h: number;
}

export interface CategoryRow {
  key: string;
  label: string;
  blurb: string;
  items: IntegrationRow[];
}

type Filter = 'all' | 'start' | 'available' | 'connected' | 'attention';

const FILTERS: [Filter, string][] = [
  ['start', 'Start here'],
  ['available', 'Ready to use'],
  ['connected', 'Connected'],
  ['attention', 'Needs attention'],
  ['all', 'Everything'],
];

export function IntegrationBoard({
  groups,
  canEdit,
  canDelete,
}: {
  groups: { group: string; categories: CategoryRow[] }[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<Filter>('start');

  const needle = query.trim().toLowerCase();

  const shown = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          categories: g.categories
            .map((c) => ({
              ...c,
              items: c.items.filter((i) => {
                if (only === 'start' && i.priority !== 1) return false;
                if (only === 'connected' && !i.complete) return false;
                if (only === 'available' && i.status !== 'wired') return false;
                if (only === 'attention' && i.failures24h === 0) return false;
                if (!needle) return true;
                return `${i.name} ${i.purpose} ${c.label} ${g.group}`
                  .toLowerCase()
                  .includes(needle);
              }),
            }))
            .filter((c) => c.items.length > 0),
        }))
        .filter((g) => g.categories.length > 0),
    [groups, needle, only],
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <Input
            type="search"
            value={query}
            placeholder="Search. Try meta, or crm, or accounting"
            aria-label="Search integrations"
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim()) setOnly('all');
            }}
          />
        </div>

        <div className="flex flex-wrap rounded-[var(--radius-sm)] border p-0.5">
          {FILTERS.map(([value, label]) => (
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

      {only === 'start' && !needle && (
        <p className="t-small muted -mt-4">
          The short list an institute is set up with. Everything else is one tab across.
        </p>
      )}

      {shown.length === 0 && (
        <Card>
          <p className="t-small muted">
            Nothing matches that. Try Everything, which has the whole catalogue in it.
          </p>
        </Card>
      )}

      {shown.map((group) => (
        <section key={group.group} className="space-y-5">
          <h2 className="t-heading border-b pb-2">{group.group}</h2>

          {group.categories.map((category) => (
            <section key={category.key} className="space-y-3">
              <div>
                <h3 className="font-medium">{category.label}</h3>
                <p className="t-small muted">{category.blurb}</p>
              </div>

              <div className="grid gap-3">
                {category.items.map((item) => (
                  <IntegrationCard
                    key={item.id}
                    item={item}
                    canEdit={canEdit}
                    canDelete={canDelete}
                  />
                ))}
              </div>
            </section>
          ))}
        </section>
      ))}
    </div>
  );
}

function when(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function IntegrationCard({
  item,
  canEdit,
  canDelete,
}: {
  item: IntegrationRow;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveIntegration, initial);
  const [mapState, mapAction, mapPending] = useActionState(saveIntegrationMapping, initial);
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [result, setResult] = useState<ActionState>({});

  const anythingStored = item.fields.some((f) => f.filled && !f.fromEnv);
  const unmapped = item.mappings.filter((m) => !m.value).length;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-prose">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {item.name}
            {item.complete && item.status === 'wired' && <Badge tone="ok">connected</Badge>}
            {item.complete && item.status === 'planned' && <Badge tone="brand">keys stored</Badge>}
            {!item.complete && <Badge tone="neutral">not connected</Badge>}
            {item.failures24h > 0 && (
              <Badge tone="bad">
                {item.failures24h} {item.failures24h === 1 ? 'error' : 'errors'} today
              </Badge>
            )}
            {item.status === 'planned' && <Badge tone="warn">code lands in {item.landsIn}</Badge>}
            {item.fromEnvCount > 0 && <Badge tone="neutral">set in the environment</Badge>}
          </p>

          <p className="t-small muted mt-1">{item.purpose}</p>

          {item.alternativeTo && (
            <p className="t-small faint mt-1">
              An alternative to {item.alternativeTo}. Connect one of them, not both, or the same
              lead arrives twice.
            </p>
          )}

          {!item.complete && item.fallback && <p className="t-small faint mt-1">{item.fallback}</p>}

          {item.lastAt && (
            <p className="t-small faint mt-1">
              {item.lastOk === false ? 'Last failed' : 'Last activity'}: {item.lastAction},{' '}
              {when(item.lastAt)}.
            </p>
          )}

          {item.complete && unmapped > 0 && (
            <p className="t-small faint mt-1">
              {unmapped} of {item.mappings.length} fields are not mapped yet, so they will not be
              sent.
            </p>
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
              {open ? 'Close' : item.complete ? 'Manage' : 'Connect'}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-5 border-t pt-4">
          {item.requires && (
            <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3">
              <p className="t-small font-medium">Before you start</p>
              <p className="t-small muted mt-1">{item.requires}</p>
            </div>
          )}

          <form action={action} className="space-y-3">
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
                    // Chrome treats any password field plus the text field
                    // before it as a login form and fills both with the
                    // admin's own credentials. "new-password" is the one
                    // value it honours.
                    autoComplete={field.kind === 'secret' ? 'new-password' : 'off'}
                    defaultValue={field.kind === 'secret' ? undefined : (field.value ?? undefined)}
                    data-1p-ignore
                    data-lpignore="true"
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
            <FormSuccess message={state.ok ? state.message : result.ok ? result.message : undefined} />

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? 'Sealing…' : anythingStored ? 'Reconnect' : 'Save'}
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

              {/*
                Zoom has a second way in, for an academy whose Zoom account
                belongs to somebody who cannot make a server to server app.
                Sign in instead, and meetings are created as that account.
              */}
              {item.id === 'zoom' &&
                (item.fields.some((f) => f.key === 'accountId' && f.filled) ? (
                  <span className="t-small faint">
                    Server to server app: no login step needed.
                  </span>
                ) : (
                  <a
                    href="/api/integrations/zoom/connect"
                    className="t-small underline"
                    style={{ color: 'var(--brand)' }}
                  >
                    Connect with a Zoom login
                  </a>
                ))}

              {anythingStored && canDelete && (
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

          {item.mappings.length > 0 && (
            <form action={mapAction} className="space-y-3 border-t pt-4">
              <input type="hidden" name="provider" value={item.id} />

              <div>
                <p className="t-small font-medium">What these are called on their side</p>
                <p className="t-small muted">
                  Every account names its fields differently. Type the name used in your own
                  {' '}
                  {item.name} account, and leave blank anything you do not want sent.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {item.mappings.map((m) => (
                  <Field key={m.key} label={m.label} hint={m.help ?? undefined}>
                    <Input
                      name={`map.${m.key}`}
                      defaultValue={m.value}
                      autoComplete="off"
                      placeholder={m.suggested ?? ''}
                    />
                  </Field>
                ))}
              </div>

              <FormError message={mapState.error} />
              <FormSuccess message={mapState.ok ? mapState.message : undefined} />

              <Button type="submit" variant="secondary" disabled={mapPending}>
                {mapPending ? 'Saving…' : 'Save mapping'}
              </Button>
            </form>
          )}

          <History provider={item.id} name={item.name} />
        </div>
      )}
    </Card>
  );
}

interface EventRow {
  id: string;
  direction: string;
  action: string;
  ok: boolean;
  records: number;
  detail: string | null;
  createdAt: string;
}

function History({ provider, name }: { provider: string; name: string }) {
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [busy, start] = useTransition();

  return (
    <div className="border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="t-small font-medium">History</p>
          <p className="t-small muted">
            Every attempt in and out, so a quiet failure does not look like a quiet week.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const response = await fetch(
                `/admin/settings/integrations/history?provider=${encodeURIComponent(provider)}`,
                { cache: 'no-store' },
              );
              setRows(response.ok ? ((await response.json()) as EventRow[]) : []);
            })
          }
        >
          {busy ? 'Loading…' : rows ? 'Refresh' : 'Show history'}
        </Button>
      </div>

      {rows !== null && rows.length === 0 && (
        <p className="t-small faint mt-3">
          Nothing has happened yet. {name} has not been asked to do anything.
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="t-small flex flex-wrap items-baseline gap-2">
              <Badge tone={row.ok ? 'ok' : 'bad'}>{row.direction.toLowerCase()}</Badge>
              <span>{row.action}</span>
              {row.records > 0 && <span className="muted">{row.records} records</span>}
              <span className="faint">{when(row.createdAt)}</span>
              {row.detail && <span className="faint w-full">{row.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
