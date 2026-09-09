'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setNotificationChannel } from '@/server/settings';
import { Badge, Card } from '@/components/ui';

type Channel = 'email' | 'sms' | 'whatsapp' | 'push';

const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'push', label: 'Push' },
];

export interface MatrixRow {
  key: string;
  label: string;
  who: string;
  live: boolean;
  waitingOn: string | null;
  templates: string[];
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  push: boolean;
}

export function Matrix({
  group,
  rows,
  canEdit,
}: {
  group: string;
  rows: MatrixRow[];
  canEdit: boolean;
}) {
  return (
    <section className="space-y-3">
      <h2 className="t-heading">{group}</h2>
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-[var(--surface-2)]">
                <th className="t-micro faint px-5 py-2.5 text-left font-semibold">Event</th>
                {CHANNELS.map((c) => (
                  <th key={c.key} className="t-micro faint px-3 py-2.5 text-center font-semibold">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.key} row={row} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

function Row({ row, canEdit }: { row: MatrixRow; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState({
    email: row.email,
    sms: row.sms,
    whatsapp: row.whatsapp,
    push: row.push,
  });
  const [error, setError] = useState<string>();

  function toggle(channel: Channel, next: boolean) {
    const previous = state[channel];
    setState((s) => ({ ...s, [channel]: next }));
    start(async () => {
      const res = await setNotificationChannel(row.key, channel, next);
      if (res.error) {
        setState((s) => ({ ...s, [channel]: previous }));
        setError(res.error);
      } else {
        setError(undefined);
        router.refresh();
      }
    });
  }

  return (
    <tr className={`border-b last:border-0 ${row.live ? '' : 'opacity-70'}`}>
      <td className="px-5 py-3">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {row.label}
          {!row.live && <Badge tone="warn">nothing emits this yet</Badge>}
        </p>
        <p className="t-micro faint">
          {row.who}
          {row.templates.length > 0 ? ` · ${row.templates.join(', ')}` : ' · no template written'}
        </p>
        {!row.live && row.waitingOn && (
          <p className="t-micro faint">Waiting on {row.waitingOn}.</p>
        )}
        {error && <p className="t-micro text-[var(--bad)]">{error}</p>}
      </td>

      {CHANNELS.map((c) => (
        <td key={c.key} className="px-3 py-3 text-center">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
            checked={state[c.key]}
            disabled={!canEdit || pending}
            aria-label={`${row.label} by ${c.label}`}
            onChange={(e) => toggle(c.key, e.target.checked)}
          />
        </td>
      ))}
    </tr>
  );
}
