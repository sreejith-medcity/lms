'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveSetting, exportSettings } from '@/server/settings';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { ImportSettings } from './transfer';

export interface SettingRow {
  key: string;
  group: string;
  label: string;
  help: string;
  kind: string;
  options: { value: string; label: string }[] | null;
  min: number | null;
  max: number | null;
  unit: string | null;
  live: boolean;
  waitingOn: string | null;
  default: boolean | number | string;
  value: boolean | number | string;
  isChanged: boolean;
  effect: string | null;
  lastChange: string | null;
}

export function SettingsBoard({
  groups,
  settings,
  canEdit,
}: {
  groups: { key: string; label: string; blurb: string }[];
  settings: SettingRow[];
  canEdit: boolean;
}) {
  const [query, setQuery] = useState('');
  const [exported, setExported] = useState<string>();
  const [busy, startExport] = useTransition();

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? settings.filter((s) =>
            `${s.label} ${s.help} ${s.key} ${s.effect ?? ''}`.toLowerCase().includes(needle),
          )
        : null,
    [needle, settings],
  );

  const changedCount = settings.filter((s) => s.isChanged).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <Input
            type="search"
            value={query}
            placeholder="Search settings — try watermark, or leaderboard"
            aria-label="Search settings"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="t-small faint">
          {changedCount === 0
            ? 'Everything is on its default.'
            : `${changedCount} changed from the default.`}
        </span>
        {canEdit && (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            disabled={busy}
            onClick={() =>
              startExport(async () => {
                const res = await exportSettings();
                setExported(res.json ?? res.error);
              })
            }
          >
            Export configuration
          </Button>
        )}
      </div>

      {exported && (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="t-heading">This academy&apos;s configuration</h2>
              <p className="t-small muted mt-1">
                Only what differs from the defaults. Paste it into another academy to start it from
                the same place.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setExported(undefined)}>
              Close
            </Button>
          </div>
          <pre className="t-small mt-3 max-h-64 overflow-auto rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3">
            {exported}
          </pre>
        </Card>
      )}

      {matches ? (
        <section className="space-y-3">
          <h2 className="t-heading">
            {matches.length} {matches.length === 1 ? 'match' : 'matches'}
          </h2>
          {matches.length === 0 ? (
            <Card>
              <p className="t-small muted">
                Nothing matches that. Custom fields, notifications and the website settings live on
                their own tabs.
              </p>
            </Card>
          ) : (
            <Card padded={false}>
              <ul className="divide-y">
                {matches.map((s) => (
                  <SettingItem key={s.key} setting={s} canEdit={canEdit} />
                ))}
              </ul>
            </Card>
          )}
        </section>
      ) : (
        groups.map((group) => {
          const rows = settings.filter((s) => s.group === group.key);
          if (rows.length === 0) return null;

          return (
            <section key={group.key} className="space-y-3">
              <div>
                <h2 className="t-heading">{group.label}</h2>
                <p className="t-small muted">{group.blurb}</p>
              </div>
              <Card padded={false}>
                <ul className="divide-y">
                  {rows.map((s) => (
                    <SettingItem key={s.key} setting={s} canEdit={canEdit} />
                  ))}
                </ul>
              </Card>
            </section>
          );
        })
      )}

      {canEdit && <ImportSettings />}
    </div>
  );
}

function SettingItem({ setting, canEdit }: { setting: SettingRow; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const [value, setValue] = useState(setting.value);

  const disabled = !canEdit || !setting.live || pending;

  function save(next: boolean | number | string) {
    const previous = value;
    setValue(next);
    start(async () => {
      const res = await saveSetting(setting.key, String(next));
      setState(res);
      if (res.error) setValue(previous);
      else router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0 max-w-prose flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {setting.label}
          {setting.isChanged && <Badge tone="brand">changed</Badge>}
          {!setting.live && <Badge tone="warn">not connected yet</Badge>}
        </p>
        <p className="t-small muted mt-1">{setting.help}</p>

        {!setting.live && setting.waitingOn && (
          <p className="t-small faint mt-1">Waiting on {setting.waitingOn}.</p>
        )}
        {setting.live && setting.effect && (
          <p className="t-small faint mt-1">{setting.effect}</p>
        )}
        {setting.lastChange && (
          <p className="t-micro faint mt-1">Last changed by {setting.lastChange}.</p>
        )}

        {state.error && <p className="t-small mt-1 text-[var(--bad)]">{state.error}</p>}
        {state.ok && state.message && <p className="t-small mt-1 text-[var(--ok)]">{state.message}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {setting.kind === 'boolean' && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
              checked={Boolean(value)}
              disabled={disabled}
              onChange={(e) => save(e.target.checked)}
            />
            <span className="t-small faint">{value ? 'on' : 'off'}</span>
          </label>
        )}

        {setting.kind === 'number' && (
          <span className="flex items-center gap-1.5">
            <Input
              type="number"
              value={String(value)}
              min={setting.min ?? undefined}
              max={setting.max ?? undefined}
              disabled={disabled}
              className="w-24"
              aria-label={setting.label}
              onChange={(e) => setValue(Number(e.target.value))}
              onBlur={(e) => save(Number(e.target.value))}
            />
            {setting.unit && <span className="t-small faint">{setting.unit}</span>}
          </span>
        )}

        {setting.kind === 'select' && setting.options && (
          <div className="w-56">
            <Select
              value={String(value)}
              disabled={disabled}
              aria-label={setting.label}
              onChange={(e) => save(e.target.value)}
            >
              {setting.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        )}

        {setting.kind === 'text' && (
          <Input
            value={String(value)}
            disabled={disabled}
            className="w-56"
            aria-label={setting.label}
            onChange={(e) => setValue(e.target.value)}
            onBlur={(e) => save(e.target.value)}
          />
        )}

        {setting.isChanged && canEdit && setting.live && (
          <button
            type="button"
            className="t-micro faint hover:underline"
            disabled={pending}
            title={`The default is ${String(setting.default)}`}
            onClick={() => save(setting.default)}
          >
            reset
          </button>
        )}
      </div>
    </li>
  );
}
