'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { setRecordingsPublished, renameRecording } from '@/server/sessions';
import type { ActionState } from '@/server/courses';
import {
  Badge,
  Button,
  Cell,
  FormError,
  FormSuccess,
  Input,
  Row,
  Select,
  Table,
} from '@/components/ui';
import { ShareRecording, type ShareRow } from './share';

export interface RecordingRow {
  id: string;
  title: string;
  isPublished: boolean;
  assetId: string;
  sizeLabel: string | null;
  durationLabel: string | null;
  sessionId: string;
  sessionTitle: string;
  batchName: string;
  roster: number;
  when: string;
  shares: ShareRow[];
}

export function Filters({
  batchId,
  state,
  query,
  batches,
}: {
  batchId: string;
  state: string;
  query: string;
  batches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [text, setText] = useState(query);

  function go(changes: Record<string, string>) {
    const params = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        go({ q: text });
      }}
    >
      <div className="w-full max-w-xs">
        <Input
          type="search"
          value={text}
          placeholder="Search titles"
          aria-label="Search recordings"
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="w-48">
        <Select value={batchId} aria-label="Batch" onChange={(e) => go({ batch: e.target.value })}>
          <option value="">All batches</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-44">
        <Select value={state} aria-label="State" onChange={(e) => go({ state: e.target.value })}>
          <option value="">Published and held back</option>
          <option value="published">Published only</option>
          <option value="hidden">Held back only</option>
        </Select>
      </div>
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

export function RecordingsTable({ rows, canEdit }: { rows: RecordingRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [state, setState] = useState<ActionState>({});
  const [editing, setEditing] = useState<string | null>(null);

  const allSelected = useMemo(
    () => rows.length > 0 && selected.length === rows.length,
    [rows.length, selected.length],
  );

  function run(work: () => Promise<ActionState>) {
    start(async () => {
      const res = await work();
      setState(res);
      if (!res.error) {
        setSelected([]);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="t-small faint">
            {selected.length > 0
              ? `${selected.length} selected`
              : 'Tick recordings to publish or hold them back together'}
          </span>
          <Button
            size="sm"
            disabled={pending || selected.length === 0}
            onClick={() => run(() => setRecordingsPublished(selected, true))}
          >
            Publish
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || selected.length === 0}
            onClick={() => run(() => setRecordingsPublished(selected, false))}
          >
            Hold back
          </Button>
        </div>
      )}

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Table
        head={[
          canEdit ? (
            <input
              key="all"
              type="checkbox"
              aria-label="Select every recording in view"
              className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
              checked={allSelected}
              onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
            />
          ) : (
            ''
          ),
          'Recording',
          'Class',
          'Batch',
          'State',
          '',
        ]}
      >
        {rows.map((r) => (
          <Row key={r.id}>
            <Cell className="w-10">
              {canEdit && (
                <input
                  type="checkbox"
                  aria-label={`Select ${r.title}`}
                  className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
                  checked={selected.includes(r.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, r.id]
                        : selected.filter((id) => id !== r.id),
                    )
                  }
                />
              )}
            </Cell>

            <Cell>
              {editing === r.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = new FormData(e.currentTarget).get('title');
                    setEditing(null);
                    run(() => renameRecording(r.id, String(value ?? '')));
                  }}
                >
                  <Input
                    name="title"
                    defaultValue={r.title}
                    autoFocus
                    maxLength={160}
                    aria-label="Recording title"
                    onBlur={() => setEditing(null)}
                    className="h-8 max-w-sm py-1"
                  />
                </form>
              ) : (
                <button
                  type="button"
                  className="text-left font-medium hover:underline"
                  title={canEdit ? 'Rename' : undefined}
                  onClick={() => canEdit && setEditing(r.id)}
                >
                  {r.title}
                </button>
              )}
              <p className="t-micro faint">
                {[r.durationLabel, r.sizeLabel].filter(Boolean).join(' · ') || 'media'}
              </p>
            </Cell>

            <Cell>
              <Link href={`/admin/sessions/${r.sessionId}`} className="text-sm hover:underline">
                {r.sessionTitle}
              </Link>
              <p className="t-micro faint">{r.when}</p>
            </Cell>

            <Cell className="muted">
              {r.batchName}
              <p className="t-micro faint">{r.roster} on the roll</p>
            </Cell>

            <Cell>
              <Badge tone={r.isPublished ? 'ok' : 'warn'}>
                {r.isPublished ? 'published' : 'held back'}
              </Badge>
            </Cell>

            <Cell className="text-right">
              <a
                href={`/api/assets/${r.assetId}`}
                target="_blank"
                rel="noreferrer noopener"
                className="t-small faint hover:underline"
              >
                Play
              </a>
              {canEdit && (
                <div className="mt-1">
                  <ShareRecording recordingId={r.id} title={r.title} shares={r.shares} />
                </div>
              )}
            </Cell>
          </Row>
        ))}
      </Table>
    </div>
  );
}
